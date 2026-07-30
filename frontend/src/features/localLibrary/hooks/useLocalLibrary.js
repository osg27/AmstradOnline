import { useCallback, useMemo, useState } from 'react';
import { groupGames } from '../core/group';
import { scanFiles } from '../core/scanner';

export function useLocalLibrary() {
  const [games, setGames] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [folderName, setFolderName] = useState('');

  const scan = useCallback(async (fileList, platform = 'amiga') => {
    setError('');
    setProgress({ complete: 0, total: fileList.length, currentFile: '' });
    try {
      const files = await scanFiles(Array.from(fileList), {
        platform,
        onProgress: (complete, total, currentFile) => setProgress({ complete, total, currentFile }),
      });
      if (!files.length) throw new Error(`No supported ${platform} files were found in that folder.`);
      setGames(groupGames(files));
      setFolderName(files[0].path.split(/[\\/]/)[0] || 'Selected folder');
    } catch (scanError) {
      setGames([]);
      setError(scanError?.message || 'The folder could not be scanned.');
    } finally {
      setProgress(null);
    }
  }, []);

  return useMemo(() => ({ games, progress, error, folderName, scan }), [error, folderName, games, progress, scan]);
}
