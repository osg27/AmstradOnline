const STORAGE_KEY = 'controller-mappings:v1';

function getMappingKey(system, controllerId) {
  return `${STORAGE_KEY}:${system}:${controllerId}`;
}

export function getControllerMapping(system, controllerId, storage = window.localStorage) {
  if (!controllerId) return null;
  const key = getMappingKey(system, controllerId);
  const data = storage.getItem(key);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function setControllerMapping(system, controllerId, mapping, storage = window.localStorage) {
  if (!controllerId) throw new Error('Controller ID is required');
  const key = getMappingKey(system, controllerId);
  storage.setItem(key, JSON.stringify(mapping));
}

export function deleteControllerMapping(system, controllerId, storage = window.localStorage) {
  if (!controllerId) return;
  const key = getMappingKey(system, controllerId);
  storage.removeItem(key);
}

export function getAllMappings(storage = window.localStorage) {
  const mappings = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_KEY)) {
      const value = storage.getItem(key);
      try {
        mappings[key] = JSON.parse(value);
      } catch {
        // Ignore corrupt entries
      }
    }
  }
  return mappings;
}

// Validates a mapping object structure
export function validateMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return false;
  for (const [action, input] of Object.entries(mapping)) {
    if (!input || typeof input !== 'object') return false;
    if (!['button', 'axis'].includes(input.type)) return false;
    if (typeof input.index !== 'number' || input.index < 0) return false;
    if (input.type === 'axis' && (![-1, 1].includes(input.direction))) return false;
  }
  return true;
}
