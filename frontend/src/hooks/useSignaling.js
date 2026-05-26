import { useCallback, useEffect, useRef, useState } from 'react';
import { getSignalingUrl } from '../api/client';

export default function useSignaling(roomCode, onMessage) {
  const wsRef = useRef(null);
  const queueRef = useRef([]);
  const onMessageRef = useRef(onMessage);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const flushQueue = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    while (queueRef.current.length > 0) {
      const message = queueRef.current.shift();
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    if (!roomCode) {
      return undefined;
    }

    const ws = new WebSocket(getSignalingUrl(roomCode));
    wsRef.current = ws;
    setIsOpen(false);

    ws.onopen = () => {
      setIsOpen(true);
      flushQueue();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        onMessageRef.current?.(message);
      } catch (error) {
        console.error('Failed to parse signaling message', error);
      }
    };

    ws.onclose = () => {
      setIsOpen(false);
    };

    ws.onerror = (error) => {
      console.error('WebSocket signaling error', error);
    };

    return () => {
      setIsOpen(false);
      ws.close();
    };
  }, [roomCode, flushQueue]);

  const send = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }

    queueRef.current.push(message);
    return false;
  }, []);

  return { send, isOpen };
}
