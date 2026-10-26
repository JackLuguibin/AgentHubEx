const providerEndpoints={Anthropic:'https://api.anthropic.com',OpenAI:'https://api.openai.com/v1',Custom:''};
let editingCredentialId=null;
function credentialHeaderRow(header={}){
  return `<div class="credential-header-row"><input name="headerName" aria-label="Header 名称" placeholder="如 X-Client-Name" value="${esc(header.name||'')}" autocomplete="off"><select name="headerType" aria-label="Header 值类型"><option value="text" ${header.type==='ref'?'':'selected'}>固定值</option><option value="ref" ${header.type==='ref'?'selected':''}>Secret 引用</option></select><input name="headerValue" aria-label="Header 值" placeholder="值或 vault:secret-name" value="${esc(header.value||'')}" autocomplete="off"><button type="button" class="header-remove" data-credential-action="remove-header" aria-label="删除此 Header">×</button></div>`;
}
function openCredentialForm(credential=null){
  const scope=credential?.scope||(state.credTab==='project'?'project':'user');
  if(!guard(scope==='project'))return;
  editingCredentialId=credential?.id??null;
  const provider=credential?.provider||'Anthropic';
  formModal((credential?'编辑':'添加')+(scope==='project'?'项目':'个人')+'凭据',`<div class="credential-form-section"><h3>基本信息</h3><div class="form-grid">${field('凭据名称','label','text',credential?.label||'','full')}<label class="field">Provider<select name="provider" id="credential-provider" aria-label="Provider">${[['Anthropic','Anthropic'],['OpenAI','OpenAI'],['Custom','OpenAI-compatible']].map(([value,label])=>`<option value="${value}" ${provider===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field">API Key${credential?'（留空保持不变）':''}<input type="password" name="secret" placeholder="${credential?'已配置 · 不回显':'输入演示值'}" autocomplete="new-password" ${credential?'':'required'}></label><label class="field full">Base URL<input name="baseUrl" id="credential-base-url" type="url" value="${esc(credential?.baseUrl??providerEndpoints[provider])}" placeholder="https://gateway.example.com/v1" required><small>填写 Provider 或兼容网关的 API 根地址，不包含具体请求路径。</small></label><label class="field full"><span>默认模型 <span class="optional-label">可选</span></span><input name="defaultModel" value="${esc(credential?.defaultModel||'')}" placeholder="留空使用项目默认模型"></label></div></div><div class="credential-form-section"><div class="credential-section-head"><h3>自定义 Headers</h3><button type="button" class="btn small" data-credential-action="add-header">＋ 添加 Header</button></div><p class="credential-field-note">用于网关路由或 API 版本等参数；认证由 API Key 注入，其他敏感值使用 Secret 引用。</p><div class="credential-header-labels"><span>Header 名称</span><span>值类型</span><span>值 / Secret 引用</span><span></span></div><div id="credential-headers">${(credential?.headers?.length?credential.headers:[{}]).map(credentialHeaderRow).join('')}</div></div><details class="credential-advanced"><summary>高级连接参数</summary><div class="form-grid"><label class="field"><span>Organization ID <span class="optional-label">可选</span></span><input name="organization" value="${esc(credential?.organization||'')}" placeholder="org-…"></label><label class="field"><span>Provider Project ID <span class="optional-label">可选</span></span><input name="providerProject" value="${esc(credential?.providerProject||'')}" placeholder="proj-…"></label><label class="field">请求超时（秒）<input name="timeoutSeconds" type="number" min="1" max="600" step="1" value="${credential?.timeoutSeconds||60}" required></label></div></details><p class="credential-field-note">本地演示保存连接配置与 Header 示例，不保存 API Key；刷新后重置。请勿输入真实密钥。</p>`,'credential',credential?'保存配置':'添加凭据');
  $('#modal').classList.add('credential-dialog');
}
function collectCredentialConfig(form){
  const d=new FormData(form),baseUrl=String(d.get('baseUrl')).trim();
  const url=new URL(baseUrl);
  if(!['http:','https:'].includes(url.protocol)){toast('Base URL 仅支持 HTTP 或 HTTPS');return null;}
  const names=d.getAll('headerName'),values=d.getAll('headerValue'),types=d.getAll('headerType');
  const headers=[],seen=new Set();
  for(let index=0;index<names.length;index++){
    const name=String(names[index]).trim(),value=String(values[index]).trim(),type=types[index];
    if(!name&&!value)continue;
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)||!value){toast('请填写有效的 Header 名称与值');return null;}
    if(seen.has(name.toLowerCase())){toast('Header 名称不能重复：'+name);return null;}
    if(/[\r\n]/.test(value)){toast('Header 值不能包含换行');return null;}
    if(type==='ref'&&!/^(vault|projectCredential|userCredential):\S+$/.test(value)){toast('Secret 引用格式示例：vault:gateway-token');return null;}
    if(['authorization','proxy-authorization','x-api-key','api-key','cookie'].includes(name.toLowerCase())&&type!=='ref'){toast('认证 Header 请使用 API Key 字段或 Secret 引用');return null;}
    seen.add(name.toLowerCase());headers.push({name,value,type});
  }
  return {label:String(d.get('label')).trim(),provider:d.get('provider'),baseUrl,defaultModel:String(d.get('defaultModel')).trim(),headers,organization:String(d.get('organization')).trim(),providerProject:String(d.get('providerProject')).trim(),timeoutSeconds:Number(d.get('timeoutSeconds'))};
}
document.addEventListener('click',e=>{
  const target=e.target.closest('[data-credential-action]');if(!target)return;
  if(target.dataset.credentialAction==='add-header')$('#credential-headers').insertAdjacentHTML('beforeend',credentialHeaderRow());
  else target.closest('.credential-header-row').remove();
});
document.addEventListener('change',e=>{
  if(e.target.id!=='credential-provider')return;
  const input=$('#credential-base-url'),current=input.value;
  if(!current||Object.values(providerEndpoints).includes(current))input.value=providerEndpoints[e.target.value];
});
