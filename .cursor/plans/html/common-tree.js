const commonTreeUI={collapsed:new Set(),selectedFile:''};
function isProtectedFolder(path){return path==='docs'||path.startsWith('docs/');}
function commonDirectories(){
  const paths=new Set(state.folders);
  for(const file of files)paths.add(file.folder);
  for(const path of [...paths]){const segments=path.split('/');while(segments.length>1){segments.pop();paths.add(segments.join('/'));}}
  return [...paths].sort((a,b)=>a.localeCompare(b));
}
function commonSpaceTree(){
  const paths=commonDirectories();
  if(commonTreeUI.selectedFile&&commonTreeUI.selectedFile.split('/').slice(0,-1).join('/')!==state.folder)commonTreeUI.selectedFile='';
  let focusPath=commonTreeUI.selectedFile||state.folder;
  for(const parent of ['',...focusPath.split('/').map((_,index,parts)=>parts.slice(0,index+1).join('/'))])if(commonTreeUI.collapsed.has(parent)){focusPath=parent;break;}
  function branch(path,label,level=1){
    const children=paths.filter(p=>p&&p.split('/').slice(0,-1).join('/')===path);
    const docs=files.filter(f=>f.folder===path);
    const open=!commonTreeUI.collapsed.has(path),selected=state.folder===path&&!commonTreeUI.selectedFile;
    return `<div role="treeitem" tabindex="${focusPath===path?'0':'-1'}" aria-level="${level}" aria-expanded="${open}" aria-selected="${selected}" data-tree-path="${esc(path)}" data-tree-kind="folder"><div class="common-tree-row ${selected?'active':''}"><button class="common-tree-toggle" tabindex="-1" data-common-action="toggle" data-path="${esc(path)}" aria-label="${open?'折叠':'展开'} ${esc(label)}">${open?'⌄':'›'}</button><button class="common-tree-label" tabindex="-1" data-common-action="folder" data-path="${esc(path)}"><span class="folder-glyph">▱</span><span class="common-tree-name">${esc(label)}</span>${isProtectedFolder(path)?'<span class="common-tree-lock" title="受保护路径">♧</span>':''}<span class="common-tree-count">${children.length+docs.length}</span></button></div><div role="group" ${open?'':'hidden'}>${children.map(p=>branch(p,p.split('/').pop(),level+1)).join('')}${docs.map(f=>{const key=(path?path+'/':'')+f.name,active=commonTreeUI.selectedFile===key;return `<button role="treeitem" aria-level="${level+1}" aria-selected="${active}" tabindex="${focusPath===key?'0':'-1'}" class="common-tree-file ${active?'active':''}" data-tree-kind="file" data-tree-path="${esc(key)}" data-common-action="file" data-folder="${esc(path)}" data-name="${esc(f.name)}" title="${esc(key)}"><span class="file-glyph">${f.name.endsWith('.json')?'{}':'≡'}</span><span class="common-tree-name">${esc(f.name)}</span></button>`;}).join('')}</div></div>`;
  }
  return `<aside class="file-tree common-space-tree"><div class="common-tree-heading"><strong>目录与文件</strong><span>项目公共空间</span></div><div class="common-tree-scroll"><div role="tree" aria-label="项目公共文件目录">${branch('','公共空间')}</div></div><div class="common-tree-foot">♧ docs/ 为受保护目录</div></aside>`;
}
function commonBreadcrumb(){const parts=state.folder.split('/').filter(Boolean);return `<nav class="common-breadcrumb" aria-label="公共文件路径"><button data-common-action="folder" data-path="">公共空间</button>${parts.map((p,index)=>`<span>/</span><button data-common-action="folder" data-path="${esc(parts.slice(0,index+1).join('/'))}" ${index===parts.length-1?'aria-current="location"':''}>${esc(p)}</button>`).join('')}</nav>`;}
function focusCommonTree(path){const item=[...document.querySelectorAll('.common-space-tree [role="treeitem"]')].find(e=>e.dataset.treePath===path);item?.focus();}
document.addEventListener('click',e=>{
  const target=e.target.closest('[data-common-action]');if(!target)return;
  const path=target.dataset.path||'';
  if(target.dataset.commonAction==='toggle'){
    const top=$('.common-tree-scroll')?.scrollTop||0;
    commonTreeUI.collapsed.has(path)?commonTreeUI.collapsed.delete(path):commonTreeUI.collapsed.add(path);
    render();$('.common-tree-scroll').scrollTop=top;focusCommonTree(path);
  }else if(target.dataset.commonAction==='folder'){
    commonTreeUI.selectedFile='';state.folder=path;commonTreeUI.collapsed.delete(path);render();focusCommonTree(path);
  }else{
    state.folder=target.dataset.folder;commonTreeUI.selectedFile=(state.folder?state.folder+'/':'')+target.dataset.name;render();previewFile(target.dataset.name);
  }
});
document.addEventListener('keydown',e=>{
  const tree=e.target.closest('.common-space-tree [role="tree"]');if(!tree)return;
  const item=e.target.closest('[role="treeitem"]');if(!item)return;
  const visible=[...tree.querySelectorAll('[role="treeitem"]')].filter(el=>el.getClientRects().length>0),index=visible.indexOf(item);
  let next;
  if(e.key==='ArrowDown')next=visible[Math.min(index+1,visible.length-1)];
  else if(e.key==='ArrowUp')next=visible[Math.max(index-1,0)];
  else if(e.key==='Home')next=visible[0];
  else if(e.key==='End')next=visible.at(-1);
  else if(e.key==='ArrowRight'&&item.dataset.treeKind==='folder'){
    if(item.getAttribute('aria-expanded')==='false')item.querySelector('.common-tree-toggle').click();else next=visible[index+1];
  }else if(e.key==='ArrowLeft'){
    if(item.dataset.treeKind==='folder'&&item.getAttribute('aria-expanded')==='true')item.querySelector('.common-tree-toggle').click();else next=item.parentElement.closest('[role="treeitem"]');
  }else if(e.key==='Enter'||e.key===' '){item.dataset.treeKind==='file'?item.click():item.querySelector('.common-tree-label').click();}
  else return;
  e.preventDefault();if(next){visible.forEach(el=>el.tabIndex=-1);next.tabIndex=0;next.focus();}
});
