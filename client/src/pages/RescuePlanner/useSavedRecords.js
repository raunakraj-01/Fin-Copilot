import { sessionFetch } from '../../services/session.js';
import { useEffect, useRef, useState } from 'react';
import { decisionApiBase } from './DecisionUI.jsx';

export function useSavedRecords(workspaceId, apiBaseUrl, path, collection, reloadKey = 0) {
  const [state, setState] = useState({ records: null, loading: false, error: '' });
  const active = useRef(null);
  async function load(background = false) {
    if (!workspaceId) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setState(previous => background === true ? { ...previous, loading: true, error: '' } : { records: null, loading: true, error: '' });
    try {
      const response = await sessionFetch(`${decisionApiBase(apiBaseUrl)}/workspaces/${encodeURIComponent(workspaceId)}/${path}`, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not load saved records');
      if (!Array.isArray(payload[collection])) throw new Error('The server returned an incomplete list');
      if (!controller.signal.aborted) setState({ records: payload[collection], loading: false, error: '' });
    } catch (error) {
      if (!controller.signal.aborted) setState({ records: null, loading: false, error: error.message });
    }
  }
  useEffect(() => {
    active.current?.abort();
    setState({ records: null, loading: false, error: '' });
    if (reloadKey > 0) load();
    return () => active.current?.abort();
  }, [workspaceId, apiBaseUrl, path, collection, reloadKey]);
  function replaceRecord(record) {
    // An older in-flight poll must not overwrite an action update's fresh projection.
    active.current?.abort();
    setState(previous => ({ ...previous, loading: false, error: '',
      records: previous.records?.map(value => value._id === record._id ? record : value) || [record] }));
  }
  return { ...state, load, replaceRecord };
}
