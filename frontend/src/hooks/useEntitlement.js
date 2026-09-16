import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

export default function useEntitlement(name) {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    let active = true;
    apiFetch('/auth/me').then((account) => {
      if (active) setGranted(Array.isArray(account.entitlements) && account.entitlements.includes(name));
    }).catch(() => {
      if (active) setGranted(false);
    });
    return () => { active = false; };
  }, [name]);
  return granted;
}
