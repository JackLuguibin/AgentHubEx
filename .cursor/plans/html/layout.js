// Adapt each page to the available main viewport without hiding its content.
function preparePageLayout(){
  const main=document.querySelector('#content');
  main.dataset.page=state.page;document.querySelector('.profile small').textContent=(userProjectRole()||'未绑定项目')+' · 预览 '+state.role;
  const tenant=currentTenant();
  if(tenant){
    const usage=tenant.id==='t-northstar'?6.4:0,percent=Math.min(100,Math.round(usage/tenant.tokens*100));
    document.querySelector('.capacity>div:first-child').innerHTML='今日 Token 用量 <strong>'+percent+'%</strong>';
    document.querySelector('.capacity .progress i').style.width=percent+'%';
    document.querySelector('.capacity small').textContent=usage+'M / '+tenant.tokens+'M · 演示用量';
  }
  // Put page guidance before the flexible primary content, consistently across pages.
  function placeSummary(block,content){
    if(!block||!content)return;
    block.classList.add('page-summary');
    block.style.removeProperty('margin-top');
    main.insertBefore(block,content);
  }
  const primary=main.querySelector(':scope > .table-wrap, :scope > .file-browser');
  main.querySelectorAll(':scope > .bottom-grid').forEach(block=>placeSummary(block,primary));
  if(state.page==='members'){placeSummary(main.querySelector(':scope > .grid-3'),primary);main.querySelector('.page-head').insertAdjacentHTML('afterend',membershipTabs());}
  if(state.page==='nodes')placeSummary(main.querySelector(':scope > .panel'),main.querySelector(':scope > .grid-3'));
  if(state.page==='config')placeSummary(main.querySelector(':scope > .banner'),main.querySelector(':scope > .tabs'));
  if(state.page==='overview'){
    const grid=main.querySelector(':scope > .grid-2');
    if(grid){grid.classList.add('overview-grid');grid.children[0].classList.add('overview-tasks');grid.children[1].classList.add('overview-summary');}
  }
  if(state.page==='settings'){
    const form=main.querySelector('#settings-form');
    if(tenant)for(const name of ['concurrency','tokens','disk'])form.elements[name].value=tenant[name];
    const boundary=main.querySelector(':scope > .settings-section');
    if(boundary)form.append(boundary);
    const labels=['基本信息','运行与凭据','公共空间','组织与配额','访问边界'];
    const nav=document.createElement('div');nav.className='tabs settings-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','项目设置分类');
    nav.innerHTML=labels.map((label,index)=>`<button type="button" role="tab" aria-selected="${index===state.settingsTab}" class="${index===state.settingsTab?'active':''}" data-action="settings-section" data-value="${index}">${label}</button>`).join('');
    form.before(nav);
    [...form.children].forEach((section,index)=>{section.hidden=index!==state.settingsTab;});
  }
}
