import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request
from PIL import Image
from app.api.routes import library_media as media


class ArtworkCacheTests(unittest.TestCase):
    def test_shelf_thumbnail_is_small_reused_and_versioned(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(media, 'MEDIA_ROOT', Path(folder)):
            original = Path(folder) / 'large.png'
            Image.new('RGB', (1200, 1800), 'red').save(original)
            thumbnail = media._shelf_thumbnail(original)
            with Image.open(thumbnail) as image:
                self.assertEqual(image.size, (320, 480))
                self.assertEqual(image.format, 'WEBP')
            with patch.object(media.Image, 'open', side_effect=AssertionError('must reuse cached thumbnail')):
                self.assertEqual(media._shelf_thumbnail(original), thumbnail)
            version = media._response_url(original).split('?')[1]
            request = Request({'type': 'http', 'query_string': (version + '&size=shelf').encode()})
            response = media.get_cached_media('large.png', request)
            self.assertEqual(response.media_type, 'image/webp')
            self.assertIn('immutable', response.headers['cache-control'])
            Image.new('RGB', (600, 900), 'blue').save(original)
            self.assertNotEqual(media._shelf_thumbnail(original), thumbnail)

    def test_versioned_file_is_browser_cacheable(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(media, 'MEDIA_ROOT', Path(folder)):
            image = Path(folder) / 'cover.png'
            image.write_bytes(b'test')
            version = media._response_url(image).split('?')[1]
            request = Request({'type': 'http', 'query_string': version.encode()})
            response = media.get_cached_media('cover.png', request)
            self.assertIn('immutable', response.headers['cache-control'])
            stale = Request({'type': 'http', 'query_string': b'v=old'})
            self.assertIn('must-revalidate', media.get_cached_media('cover.png', stale).headers['cache-control'])

    def test_shared_cached_image_does_not_contact_provider(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(media, 'MEDIA_ROOT', Path(folder)), patch.object(media, 'urlopen') as upstream:
            url = 'https://example.com/front.png'
            key = hashlib.sha256(f'spectrum-front\0{url}'.encode()).hexdigest()
            target = Path(folder) / 'boxart' / 'spectrum-front' / f'{key}.png'
            target.parent.mkdir(parents=True)
            target.write_bytes(b'cached image')
            result = media.cache_box_art(media.BoxArtCacheRequest(url=url, system='spectrum-front', rom_name='game'))
            self.assertTrue(result['cached'])
            upstream.assert_not_called()


if __name__ == '__main__':
    unittest.main()
