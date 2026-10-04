export function shelfArtworkUrl(value) {
  if (!value || !value.includes('/library/media/files/')) return value;
  const [path, query = ''] = value.split('?');
  const params = new URLSearchParams(query);
  params.set('size', 'shelf');
  return `${path}?${params}`;
}
