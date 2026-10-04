import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('fronts', Path(__file__).with_name('import-spectrum-front-covers.py'))
fronts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fronts)


class FrontCoverTests(unittest.TestCase):
    def test_only_spectrum_box_fronts_are_selected(self):
        xml = '''<LaunchBox>
        <Game><DatabaseID>1</DatabaseID><Name>1942</Name><Platform>Sinclair ZX Spectrum</Platform></Game>
        <Game><DatabaseID>2</DatabaseID><Name>1942 Mission</Name><Platform>Sinclair ZX Spectrum</Platform></Game>
        <Game><DatabaseID>3</DatabaseID><Name>1942</Name><Platform>Amstrad CPC</Platform></Game>
        <GameImage><DatabaseID>1</DatabaseID><Type>Box - Back</Type><FileName>back.jpg</FileName></GameImage>
        <GameImage><DatabaseID>1</DatabaseID><Type>Box - Front</Type><FileName>front.jpg</FileName></GameImage>
        <GameImage><DatabaseID>2</DatabaseID><Type>Box - 3D</Type><FileName>3d.jpg</FileName></GameImage>
        <GameImage><DatabaseID>2</DatabaseID><Type>Box - Front</Type><FileName>world.jpg</FileName><Region>World</Region></GameImage>
        <GameImage><DatabaseID>2</DatabaseID><Type>Box - Front</Type><FileName>uk.jpg</FileName><Region>United Kingdom</Region></GameImage>
        <GameImage><DatabaseID>3</DatabaseID><Type>Box - Front</Type><FileName>cpc.jpg</FileName></GameImage>
        </LaunchBox>'''
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('Metadata.xml', xml)
        with zipfile.ZipFile(data) as archive:
            result = fronts.build(archive)
        self.assertEqual([(c['title'], c['url'].rsplit('/', 1)[-1]) for c in result['covers']], [('1942', 'front.jpg'), ('1942 Mission', 'uk.jpg')])


if __name__ == '__main__':
    unittest.main()
