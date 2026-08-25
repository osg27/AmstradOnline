import { useEffect, useRef, useState } from 'react';
import { GameRecorder } from './gameRecorder';

export function useGameRecorder(sourceFactory) {
  const sourceFactoryRef = useRef(sourceFactory);
  sourceFactoryRef.current = sourceFactory;
  const recorderRef = useRef(null);
  if (!recorderRef.current) recorderRef.current = new GameRecorder({ sourceFactory: () => sourceFactoryRef.current() });
  const [state, setState] = useState(recorderRef.current.state);

  useEffect(() => {
    const recorder = recorderRef.current;
    const unsubscribe = recorder.subscribe(setState);
    return () => {
      unsubscribe();
      recorder.destroy();
    };
  }, []);

  return {
    ...state,
    startRecording: (options) => recorderRef.current.start(options),
    stopRecording: () => recorderRef.current.stop(),
    resetRecording: () => recorderRef.current.reset(),
  };
}
