// A user is global; tenant and project roles belong to separate membership records.
const accountRecords=[
  {id:'u-jack',name:'Jack Lu',email:'jack@northstar.example',initial:'JL',color:'green'},
  {id:'u-sarah',name:'Sarah Chen',email:'sarah@northstar.example',initial:'SC',color:'purple'},
  {id:'u-alex',name:'Alex Wang',email:'alex@northstar.example',initial:'AW',color:'blue'},
  {id:'u-liam',name:'Liam Zhang',email:'liam@northstar.example',initial:'LZ',color:'orange'}
];
let tenantMemberships=[
  {userId:'u-jack',tenantId:'t-northstar',role:'owner'},{userId:'u-jack',tenantId:'t-orbit',role:'owner'},{userId:'u-jack',tenantId:'t-sandbox',role:'owner'},
  {userId:'u-sarah',tenantId:'t-northstar',role:'member'},{userId:'u-sarah',tenantId:'t-orbit',role:'member'},
  {userId:'u-alex',tenantId:'t-northstar',role:'admin'},{userId:'u-liam',tenantId:'t-northstar',role:'member'}
];
let projectMemberships=[
  ...['p-agenthub','p-docs','p-legacy','p-research'].map(projectId=>({userId:'u-jack',projectId,role:'owner'})),
  {userId:'u-sarah',projectId:'p-agenthub',role:'developer'},{userId:'u-sarah',projectId:'p-docs',role:'viewer'},{userId:'u-sarah',projectId:'p-research',role:'developer'},
  {userId:'u-alex',projectId:'p-agenthub',role:'developer'},{userId:'u-alex',projectId:'p-docs',role:'developer'},{userId:'u-liam',projectId:'p-agenthub',role:'viewer'}
];
const membershipUI={view:'project',query:'',editingUser:null};
const currentAccountId='u-jack';
const isPlatformOperator=()=>managementUI.platformAdmin&&state.role==='owner';
const userTenantRole=(tenantId=state.tenantId,userId=currentAccountId)=>tenantMemberships.find(m=>m.userId===userId&&m.tenantId===tenantId)?.role;
const userProjectRole=(projectId=state.projectId,userId=currentAccountId)=>projectMemberships.find(m=>m.userId===userId&&m.projectId===projectId)?.role;
const hasTenantBinding=(tenantId,userId=currentAccountId)=>!!userTenantRole(tenantId,userId);
const canViewProjectMetadata=p=>isPlatformOperator()||canManageTenantBindings(p.tenantId)||hasProjectBinding(p.id);
const hasProjectBinding=(projectId,userId=currentAccountId)=>!!userProjectRole(projectId,userId);
const canManageProjectMetadata=projectId=>state.role==='owner'&&(canManageTenantBindings(projectRecords.find(p=>p.id===projectId)?.tenantId)||userProjectRole(projectId)==='owner');
const canManageTenantBindings=(tenantId)=>state.role==='owner'&&(isPlatformOperator()||['owner','admin'].includes(userTenantRole(tenantId)));
function syncMembershipViews(){
  members=projectMemberships.filter(m=>m.projectId===state.projectId).map(m=>{const u=accountRecords.find(u=>u.id===m.userId);return u?{...u,userId:u.id,role:m.role}:null;}).filter(Boolean);
  for(const p of projectRecords){p.memberCount=projectMemberships.filter(m=>m.projectId===p.id).length;const owners=projectMemberships.filter(m=>m.projectId===p.id&&m.role==='owner').map(m=>accountRecords.find(u=>u.id===m.userId)?.name);if(owners.length&&!owners.includes(p.owner))p.owner=owners[0];}
  for(const t of tenantRecords){const owners=tenantMemberships.filter(m=>m.tenantId===t.id&&m.role==='owner').map(m=>accountRecords.find(u=>u.id===m.userId));if(owners.length&&!owners.some(u=>u?.name===t.owner)){t.owner=owners[0].name;t.email=owners[0].email;}}
}
function accountTenantBindings(userId){return tenantMemberships.filter(m=>m.userId===userId).map(m=>({...m,tenant:tenantRecords.find(t=>t.id===m.tenantId)})).filter(m=>m.tenant);}
function accountProjectBindings(userId){return projectMemberships.filter(m=>m.userId===userId).map(m=>({...m,project:projectRecords.find(p=>p.id===m.projectId)})).filter(m=>m.project);}
function memberPage(){return membershipUI.view==='users'?userDirectoryPage():projectMemberPage();}
function membershipTabs(){return `<div class="tabs membership-tabs" role="tablist" aria-label="成员管理视图">${[['project','当前项目成员'],['users','用户与多空间绑定']].map(([key,name])=>`<button role="tab" aria-selected="${membershipUI.view===key}" class="${membershipUI.view===key?'active':''}" data-binding-action="view" data-value="${key}">${name}</button>`).join('')}</div>`;}
function userDirectoryPage(){
  const allowed=isPlatformOperator()||canManageTenantBindings(state.tenantId);
  if(!allowed)return title('用户与归属','用户账号与空间成员关系分别管理。')+'<div class="surface empty">需要租户管理员权限。<br>'+btn('查看我的租户与项目','binding-user',false,`data-value="${currentAccountId}"`)+'</div>';
  const users=accountRecords.filter(u=>(isPlatformOperator()||hasTenantBinding(state.tenantId,u.id))&&(u.name+' '+u.email).toLowerCase().includes(membershipUI.query.toLowerCase()));
  return managementHeading('用户与归属','一个用户账号可以加入多个租户，并在不同项目中拥有独立角色。',btn('＋ 添加用户','binding-new-user',true))+`<div class="surface management-guidance"><div><strong>一个账号，多个空间，独立权限</strong><p>租户角色与项目角色独立设置；项目绑定必须先具备其所属租户的成员关系。</p></div>${btn('我的归属','binding-user',false,`data-value="${currentAccountId}"`)}</div><div class="toolbar"><span class="management-count">${users.length} 位用户 · 支持跨租户绑定</span><label class="search"><span class="sr-only">搜索用户</span><input id="binding-user-search" value="${esc(membershipUI.query)}" placeholder="搜索姓名或邮箱"></label></div><div class="management-table-area" id="binding-user-results">${accountDirectoryTable(users)}</div>`;
}
function accountDirectoryTable(users){return table(['用户账号','已绑定租户','已绑定项目','操作'],users.map(u=>{const ts=accountTenantBindings(u.id),ps=accountProjectBindings(u.id);return `<tr><td><span class="avatar ${u.color}">${esc(u.initial)}</span><strong>${esc(u.name)}</strong>${u.id===currentAccountId?badge('当前用户','green'):''}<small>${esc(u.email)} · ${u.id}</small></td><td><div class="binding-badges">${ts.map(m=>`<span class="badge" title="${esc(m.tenant.name)}">${esc(m.tenant.name)} · ${m.role}</span>`).join('')||badge('未绑定')}</div><small>${ts.length} 个租户</small></td><td><div class="binding-badges">${ps.map(m=>`<span class="badge" title="${esc(tenantRecords.find(t=>t.id===m.project.tenantId)?.name)}">${esc(m.project.name)} · ${m.role}</span>`).join('')||badge('未绑定')}</div><small>${ps.length} 个项目</small></td><td>${btn('管理绑定','binding-user',false,`data-value="${u.id}"`)}</td></tr>`;}));}
function openUserBindings(userId){
  const user=accountRecords.find(u=>u.id===userId);if(!user)return;
  const edit=isPlatformOperator()||canManageTenantBindings(state.tenantId);
  if(!edit&&userId!==currentAccountId){toast('无权管理此用户的归属');return;}
  membershipUI.editingUser=userId;
  const tenants=tenantRecords.filter(t=>isPlatformOperator()||canManageTenantBindings(t.id)||hasTenantBinding(t.id,userId)&&userId===currentAccountId);
  const body=`<div class="binding-account"><span class="avatar ${user.color}">${esc(user.initial)}</span><div><strong>${esc(user.name)}</strong><small>${esc(user.email)} · 同一账号跨空间复用</small></div>${badge(edit?'可编辑':'只读')}</div><p class="binding-description">勾选多个租户，再选择各租户下的项目。角色按空间分别生效，取消租户绑定会一并移除其下的项目绑定。</p><div class="binding-tenant-list">${tenants.map(t=>{
    const selected=hasTenantBinding(t.id,userId),canEdit=canManageTenantBindings(t.id),projects=projectRecords.filter(p=>p.tenantId===t.id);
    return `<section class="binding-tenant" data-tenant="${t.id}"><div class="binding-tenant-heading"><label><input type="checkbox" name="tenant:${t.id}" value="on" ${selected?'checked':''} ${!canEdit?'disabled':''} data-binding-tenant="${t.id}"><strong>${esc(t.name)}</strong></label>${t.status!=='active'?badge('已停用','orange'):''}<label class="binding-role">租户角色<select name="tenantRole:${t.id}" aria-label="${esc(t.name)} 的租户角色" ${!selected||!canEdit?'disabled':''}>${['owner','admin','member'].map(r=>`<option ${userTenantRole(t.id,userId)===r||!selected&&r==='member'?'selected':''}>${r}</option>`).join('')}</select></label></div><div class="binding-project-list">${projects.map(p=>{const role=userProjectRole(p.id,userId);return `<div class="binding-project"><label><input type="checkbox" name="project:${p.id}" value="on" ${role?'checked':''} ${!selected||!canEdit?'disabled':''} data-binding-project="${p.id}"><span>▧ ${esc(p.name)}<small>${esc(p.key)}${p.status==='archived'?' · 已归档':''}</small></span></label><select name="projectRole:${p.id}" aria-label="${esc(p.name)} 的项目角色" ${!selected||!role||!canEdit?'disabled':''}>${['owner','developer','viewer'].map(r=>`<option ${role===r||!role&&r==='developer'?'selected':''}>${r}</option>`).join('')}</select></div>`;}).join('')||'<p class="binding-empty">此租户暂无项目，可以先绑定租户。</p>'}</div></section>`;
  }).join('')}</div><p class="credential-field-note">至少保留一名租户 owner 和项目 owner；停用租户与归档项目的绑定可保留，恢复前不可进入工作区。</p>`;
  if(edit)formModal('管理用户的租户与项目绑定',body,'binding-memberships','保存绑定');else modal('我的租户与项目',body);
  $('#modal').classList.add('membership-dialog');
}
function saveUserBindings(form){
  const userId=membershipUI.editingUser,d=new FormData(form),editable=tenantRecords.filter(t=>canManageTenantBindings(t.id));
  if(!editable.length){toast('没有可管理的租户');return false;}
  const editedIds=new Set(editable.map(t=>t.id));
  const nextTenants=tenantMemberships.filter(m=>m.userId!==userId||!editedIds.has(m.tenantId));
  const nextProjects=projectMemberships.filter(m=>m.userId!==userId||!editedIds.has(projectRecords.find(p=>p.id===m.projectId)?.tenantId));
  for(const t of editable){if(!d.has('tenant:'+t.id))continue;const role=d.get('tenantRole:'+t.id);if(!['owner','admin','member'].includes(role)){toast('请选择有效的租户角色');return false;}nextTenants.push({userId,tenantId:t.id,role});for(const p of projectRecords.filter(p=>p.tenantId===t.id)){if(!d.has('project:'+p.id))continue;const projectRole=d.get('projectRole:'+p.id);if(!['owner','developer','viewer'].includes(projectRole)){toast('请选择有效的项目角色');return false;}nextProjects.push({userId,projectId:p.id,role:projectRole});}}
  for(const t of editable){if(tenantMemberships.some(m=>m.tenantId===t.id&&m.role==='owner')&&!nextTenants.some(m=>m.tenantId===t.id&&m.role==='owner')){toast(t.name+' 必须保留至少一名 owner');return false;}}
  for(const p of projectRecords.filter(p=>editedIds.has(p.tenantId))){if(projectMemberships.some(m=>m.projectId===p.id&&m.role==='owner')&&!nextProjects.some(m=>m.projectId===p.id&&m.role==='owner')){toast(p.name+' 必须保留至少一名 owner');return false;}}
  tenantMemberships=nextTenants;projectMemberships=nextProjects;syncMembershipViews();
  if(userId===currentAccountId&&!hasProjectBinding(state.projectId))sessions.forEach(s=>{if(s.status==='进行中')s.status='已停止';});
  audit('更新用户 '+accountRecords.find(u=>u.id===userId).name+' 的多租户 / 多项目绑定','成员');return true;
}
function ensureAccount(name,email){let user=accountRecords.find(u=>u.email.toLowerCase()===email.toLowerCase());if(!user){user={id:'u-'+(accountRecords.length+1),name,email,initial:name.slice(0,2).toUpperCase(),color:'blue'};accountRecords.push(user);}return user;}
function ensureTenantMember(userId,tenantId,role='member'){const m=tenantMemberships.find(m=>m.userId===userId&&m.tenantId===tenantId);if(!m)tenantMemberships.push({userId,tenantId,role});else if(role==='owner')m.role=role;}
function ensureProjectMember(userId,projectId,role){const project=projectRecords.find(p=>p.id===projectId);ensureTenantMember(userId,project.tenantId);const m=projectMemberships.find(m=>m.userId===userId&&m.projectId===projectId);if(m)m.role=role;else projectMemberships.push({userId,projectId,role});}
function addAccountToProject(data){const user=ensureAccount(data.name.trim(),data.email.trim());if(hasProjectBinding(state.projectId,user.id)){toast('此用户已绑定当前项目，可通过管理绑定修改角色');return false;}ensureProjectMember(user.id,state.projectId,data.role);syncMembershipViews();return true;}
function changeCurrentMemberRole(member,role){const owners=projectMemberships.filter(m=>m.projectId===state.projectId&&m.role==='owner');if(member.role==='owner'&&role!=='owner'&&owners.length===1){toast('项目必须保留至少一名 owner');return false;}projectMemberships.find(m=>m.projectId===state.projectId&&m.userId===member.userId).role=role;syncMembershipViews();return true;}
function removeCurrentMember(member){if(member.role==='owner'&&projectMemberships.filter(m=>m.projectId===state.projectId&&m.role==='owner').length===1){toast('不能移除项目的最后一名 owner');return false;}projectMemberships=projectMemberships.filter(m=>m.projectId!==state.projectId||m.userId!==member.userId);if(member.userId===currentAccountId)sessions.forEach(s=>{if(s.status==='进行中')s.status='已停止';});syncMembershipViews();return true;}
document.addEventListener('click',e=>{const button=e.target.closest('[data-binding-action], [data-action="binding-user"], [data-action="binding-new-user"], [data-action="binding-open-directory"]');if(!button)return;if(button.dataset.action==='binding-open-directory'){membershipUI.view='users';navigate('members');return;}if(button.dataset.bindingAction==='view'){membershipUI.view=button.dataset.value;render();return;}if(button.dataset.action==='binding-user'){openUserBindings(button.dataset.value);return;}if(!canManageTenantBindings(state.tenantId)){toast('需要租户管理员权限');return;}formModal('添加用户账号',`<div class="form-grid">${field('显示名','name')}${field('邮箱','email','email')}</div><p>账号创建后可绑定多个租户和项目。本地原型不会发送邮件。</p>`,'binding-user','创建并绑定');});
document.addEventListener('change',e=>{
  if(e.target.hasAttribute('data-binding-tenant')){const group=e.target.closest('.binding-tenant'),enabled=e.target.checked;group.querySelector('[name^="tenantRole:"]').disabled=!enabled;for(const row of group.querySelectorAll('.binding-project')){const checkbox=row.querySelector('input');checkbox.disabled=!enabled;if(!enabled)checkbox.checked=false;row.querySelector('select').disabled=!enabled||!checkbox.checked;}}
  if(e.target.hasAttribute('data-binding-project'))e.target.closest('.binding-project').querySelector('select').disabled=!e.target.checked;
});
document.addEventListener('submit',e=>{const form=e.target;if(form.id!=='active-form'||!form.dataset.submit.startsWith('binding-'))return;e.preventDefault();if(form.dataset.submit==='binding-memberships'){if(!saveUserBindings(form))return;closeModal();render();toast('多租户与多项目绑定已保存（演示）');}else{if(!canManageTenantBindings(state.tenantId))return;const d=Object.fromEntries(new FormData(form));if(accountRecords.some(u=>u.email.toLowerCase()===d.email.trim().toLowerCase())){toast('账号已存在，请在用户列表中管理绑定');return;}if(!d.name.trim()){toast('请输入显示名');return;}const user=ensureAccount(d.name.trim(),d.email.trim());closeModal();render();openUserBindings(user.id);}});
document.addEventListener('input',e=>{if(e.target.id!=='binding-user-search')return;membershipUI.query=e.target.value;const users=accountRecords.filter(u=>(isPlatformOperator()||hasTenantBinding(state.tenantId,u.id))&&(u.name+' '+u.email).toLowerCase().includes(membershipUI.query.toLowerCase()));$('#binding-user-results').innerHTML=accountDirectoryTable(users);$('.management-count').textContent=users.length+' 位用户 · 支持跨租户绑定';});
