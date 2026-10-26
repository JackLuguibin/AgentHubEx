// Sample workspace explorer. The prototype never reads the local filesystem.
const workspaceUI = {tab:'files',active:'src/gateway.ts',open:['src/gateway.ts'],pane:'chat',editorTab:'code',draft:'',terminal:false,collapsed:['project-common','tests']};
const workspaceFiles = {
  'src/gateway.ts': {status:'M',content:`import { Hono } from 'hono';
import { requireMember } from './auth';
import { resolveWorkspace } from './workspace';

const app = new Hono();

// All runtime requests pass through the Hub Facade.
app.use('/v1/projects/:projectId/*', requireMember);

app.post('/v1/projects/:projectId/sessions', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const workspace = await resolveWorkspace({
    projectId,
    ownerUserId: user.id,
  });

  return c.json({
    workspaceId: workspace.id,
    status: 'ready',
  });
});

export default app;`},
  'src/auth.ts': {content:`import type { MiddlewareHandler } from 'hono';

export const requireMember: MiddlewareHandler = async (c, next) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  await assertProjectMembership(user.id, projectId);
  await next();
};`},
  'src/workspace.ts': {status:'A',content:`export async function resolveWorkspace(input: {
  projectId: string;
  ownerUserId: string;
}) {
  // One member workspace maps to one isolated runtime.
  return workspaceService.findOrCreate(input);
}`},
  'tests/isolation.test.ts': {content:`import { describe, it, expect } from 'vitest';

describe('workspace isolation', () => {
  it('rejects another user accessing the session', async () => {
    const response = await requestAsOtherUser('/v1/sessions/demo');
    expect(response.status).toBe(403);
  });
});`},
  'package.json': {content:'{\n  "name": "@agenthub/hub-api",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "test": "vitest"\n  }\n}'},
  'AGENTS.md': {content:'# Workspace instructions\n\nUse the project conventions in project-common/docs.\nKeep requests scoped to tenant and owner.\nAsk the session owner before privileged execution.'},
  'README.md': {content:'# AgentHubEx\n\nA multi-tenant, isolated Agent workspace.\n\n## Development\n\npnpm install\npnpm dev\n\nThis is a sample workspace for the HTML prototype.'}
};
function workspaceEntries(){return {...(state.projectId==='p-agenthub'?workspaceFiles:{}),...Object.fromEntries(files.map(f=>['project-common/'+f.folder+'/'+f.name,{content:f.content,readonly:true}]))};}
function workspaceButton(label,action,value='',extra=''){return `<button data-workspace-action="${action}" data-path="${esc(value)}" ${extra}>${label}</button>`;}
function workspaceTree(entries,prefix=''){
  const names=[...new Set(Object.keys(entries).filter(p=>p.startsWith(prefix)).map(p=>p.slice(prefix.length).split('/')[0]))];
  names.sort((a,b)=>{const ad=Object.keys(entries).some(p=>p.startsWith(prefix+a+'/')),bd=Object.keys(entries).some(p=>p.startsWith(prefix+b+'/'));return Number(bd)-Number(ad)||a.localeCompare(b);});
  return names.map(name=>{const path=prefix+name;const isFolder=Object.keys(entries).some(p=>p.startsWith(path+'/'));return isFolder?`<details class="workspace-folder" data-directory="${esc(path)}" ${workspaceUI.collapsed.includes(path)?'':'open'}><summary><span class="folder-chevron">›</span><span class="folder-glyph">▱</span>${esc(name)}${path==='project-common'?'<span class="tree-readonly">只读</span>':''}</summary><div class="folder-children">${workspaceTree(entries,path+'/')}</div></details>`:workspaceButton(`<span class="file-glyph">${name.endsWith('.ts')?'TS':name.endsWith('.json')?'{}':'≡'}</span><span class="tree-filename">${esc(name)}</span>${entries[path].status?`<span class="file-status">${entries[path].status}</span>`:entries[path].readonly?'<span class="tree-lock">♧</span>':''}`,'open',path,`class="tree-file ${workspaceUI.active===path?'active':''}" title="/workspace/${esc(path)}"`);}).join('');
}
function workspaceSidebar(){return `<aside class="session-sidebar workspace-explorer"><div class="explorer-tabs">${workspaceButton('文件','tab','files',`class="${workspaceUI.tab==='files'?'active':''}"`)}${workspaceButton('会话','tab','sessions',`class="${workspaceUI.tab==='sessions'?'active':''}"`)}</div><div class="workspace-root"><strong>▱ ${esc(state.project)}</strong><small>/workspace · Jack Lu</small></div>${workspaceUI.tab==='files'?`<div class="workspace-tree" aria-label="工作空间文件浏览器">${workspaceTree(workspaceEntries())}</div><div class="explorer-note">个人工作区 · 示例文件<br>project-common 为只读公共资料</div>`:`<div class="workspace-sessions">${sessions.map(s=>`<button class="session-entry ${s.id===state.sessionId?'active':''}" data-action="session" data-value="${s.id}">${esc(s.title)}<br><span class="phase">${esc(s.engine)} · ${esc(s.status)}</span></button>`).join('')}</div>`}</aside>`;}
function workspacePaneTabs(){return `<div class="workspace-pane-tabs">${[['files','文件'],['chat','会话'],['code','代码']].map(([id,label])=>workspaceButton(label,'pane',id,`class="${workspaceUI.pane===id?'active':''}"`)).join('')}</div>`;}
function workspaceEditor(){const entries=workspaceEntries(),f=entries[workspaceUI.active];return `<section class="workspace-editor" aria-label="工作空间文件预览"><div class="editor-tabs">${workspaceUI.open.filter(p=>entries[p]).map(p=>`<div class="editor-file-tab ${p===workspaceUI.active?'active':''}">${workspaceButton(esc(p.split('/').pop()),'open',p)}${workspaceButton('×','close-file',p,`aria-label="关闭 ${esc(p)}"`)}</div>`).join('')||'<span class="editor-placeholder">文件预览</span>'}</div>${f?`<div class="editor-path"><span title="/workspace/${esc(workspaceUI.active)}">${esc(workspaceUI.active)}</span>${f.readonly?badge('只读'):badge(f.status==='M'?'已修改':f.status==='A'?'新增':'个人文件',f.status?'orange':'')}</div><div class="editor-tools"><div>${workspaceButton('代码','editor-tab','code',`class="${workspaceUI.editorTab==='code'?'active':''}"`)}${workspaceButton('文件信息','editor-tab','info',`class="${workspaceUI.editorTab==='info'?'active':''}"`)}</div><div>${workspaceButton('引用到会话','attach',workspaceUI.active)}${workspaceButton('复制路径','copy-path',workspaceUI.active)}</div></div>${workspaceUI.editorTab==='code'?`<div class="source-view">${f.content.split('\n').map((line,index)=>`<div class="source-line"><span class="line-number">${index+1}</span><code>${esc(line)||' '}</code></div>`).join('')}</div>`:`<div class="file-info"><h3>${esc(workspaceUI.active.split('/').pop())}</h3><p>路径：/workspace/${esc(workspaceUI.active)}</p><p>归属：${f.readonly?'项目公共空间 · 同步镜像':'Jack Lu 的个人工作区'}</p><p>权限：${f.readonly?'只读，需在公共文件模块编辑':'个人可写，当前为内容预览'}</p><p>大小：${new Blob([f.content]).size} bytes</p><p>行数：${f.content.split('\n').length}</p></div>`}<div class="editor-status"><span>${f.readonly?'♧ 只读公共资料':'⌁ main* · 个人工作区'}</span><span>UTF-8 · ${workspaceUI.active.endsWith('.ts')?'TypeScript':'Text'}</span></div>`:`<div class="editor-empty"><span>▤</span><h3>打开工作空间文件</h3><p>点击左侧文件树，查看代码或项目公共资料。</p>${workspaceButton('浏览文件','pane','files')}</div>`}</section>`;}
function refreshWorkspace(captureDraft=true){const draft=$('#chat-form textarea');if(captureDraft&&draft)workspaceUI.draft=draft.value;render();const input=$('#chat-form textarea');if(input)input.value=workspaceUI.draft;}
document.addEventListener('input',e=>{if(e.target.matches('#chat-form textarea'))workspaceUI.draft=e.target.value;});
document.addEventListener('submit',e=>{if(e.target.id==='chat-form'&&canWrite())workspaceUI.draft='';});
document.addEventListener('click',async e=>{const target=e.target.closest('[data-workspace-action]');if(!target)return;if(!guard())return;const action=target.dataset.workspaceAction,path=target.dataset.path;
  switch(action){
    case 'tab':workspaceUI.tab=path;refreshWorkspace();break;
    case 'pane':workspaceUI.pane=path;refreshWorkspace();break;
    case 'open':workspaceUI.active=path;if(!workspaceUI.open.includes(path))workspaceUI.open.push(path);workspaceUI.pane='code';workspaceUI.editorTab='code';refreshWorkspace();break;
    case 'close-file':workspaceUI.open=workspaceUI.open.filter(p=>p!==path);if(workspaceUI.active===path)workspaceUI.active=workspaceUI.open.at(-1)||'';refreshWorkspace();break;
    case 'editor-tab':workspaceUI.editorTab=path;refreshWorkspace();break;
    case 'attach':{const input=$('#chat-form textarea');workspaceUI.draft=(input?.value||workspaceUI.draft)+(input?.value?'\n':'')+'@/workspace/'+path+' ';workspaceUI.pane='chat';refreshWorkspace(false);$('#chat-form textarea')?.focus();toast('文件路径已引用到会话输入框');break;}
    case 'copy-path':try{await navigator.clipboard.writeText('/workspace/'+path);toast('工作空间路径已复制');}catch{modal('文件路径',`<pre class="code">/workspace/${esc(path)}</pre>`);}break;
  }
});

document.addEventListener('toggle',e=>{if(!e.target.matches?.('.workspace-folder'))return;const path=e.target.dataset.directory;workspaceUI.collapsed=workspaceUI.collapsed.filter(p=>p!==path);if(!e.target.open)workspaceUI.collapsed.push(path);},true);
