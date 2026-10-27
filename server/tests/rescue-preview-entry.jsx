import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RescuePlanner from '../../client/src/pages/RescuePlanner.jsx';
import OrderAnalyzer from '../../client/src/pages/OrderAnalyzer.jsx';

function Preview() {
  const [page, setPage] = useState('rescue');
  const [workspace, setWorkspace] = useState('demo');
  return <><aside style={{ padding: '14px 24px', background: '#173f3a', color: 'white', fontFamily: 'system-ui', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
    <strong>PERSON 2 · SYNTHETIC PREVIEW</strong><span>Test forecast stub; no database or saved changes.</span>
    <button onClick={() => setPage('rescue')}>Rescue planner</button><button onClick={() => setPage('orders')}>Order analyzer</button>
    <label>Workspace <select value={workspace} onChange={event => setWorkspace(event.target.value)}><option value="demo">CSV shortage demo</option><option value="isolated">Isolated order example</option></select></label>
  </aside>{page === 'rescue' ? <RescuePlanner workspaceId={workspace === 'demo' ? '000000000000000000000001' : '000000000000000000000002'} apiBaseUrl="/api" /> : <OrderAnalyzer workspaceId={workspace === 'demo' ? '000000000000000000000001' : '000000000000000000000002'} apiBaseUrl="/api" />}</>;
}
createRoot(document.getElementById('root')).render(<Preview />);
