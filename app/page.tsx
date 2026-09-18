'use client'
import { useEffect, useMemo, useState } from 'react'
import { useStudioContext } from './components/studio-context'
import StylePresetSelector from './components/style-preset-selector'
import DurationModeSelector from './components/duration-mode-selector'
import { EMPTY_OVERRIDE_SUMMARY } from './lib/prompt/prompt-compiler'

const moves=['POV 主观视角','FPV 穿越视角','环绕运镜','希区柯克变焦','跟拍','手持感','缓慢推进','焦点转移','过肩反打镜头 Over-the-Shoulder / Reverse Shot','子弹时间运镜 Bullet Time','慢门镜头 Slow Shutter','斜角镜头 Dutch Angle','Fly Through 穿越运镜','低机位 Dolly In 前推','后拉揭示 Dolly Out','斯坦尼康稳定跟拍 Steadicam Follow','升降运镜 Crane Up/Down','横移平移 Tracking / Truck','慢滚旋转 Dutch Roll']
const moveDescriptions:Record<string,string>={
 'POV 主观视角':'像人物亲眼看到的画面，适合发现秘密和紧张时刻。',
 'FPV 穿越视角':'镜头像飞行一样快速穿过空间，适合进入场景和追逐。',
 '环绕运镜':'镜头围着人物转一圈，突出反转、震惊或关系变化。',
 '希区柯克变焦':'人物不动，背景像被拉开，表现突然震惊或失衡。',
 '跟拍':'镜头跟在人物身后或侧面走，适合离开、追逐和前进。',
 '手持感':'画面有轻微呼吸和晃动，像摄影师在现场跟着拍。',
 '缓慢推进':'镜头一点点靠近人物，让情绪逐渐变强。',
 '焦点转移':'先看前面的东西，再把清晰度转到人物或关键线索。',
 '过肩反打镜头 Over-the-Shoulder / Reverse Shot':'从一个人的肩膀后面拍另一个人，适合对话和对峙。',
 '子弹时间运镜 Bullet Time':'动作变慢，镜头绕着人物转，适合定格爆点。',
 '慢门镜头 Slow Shutter':'移动的人或灯光留下拖影，画面更有速度感。',
 '斜角镜头 Dutch Angle':'画面向一边倾斜，表示不安、混乱或局势失控。',
 'Fly Through 穿越运镜':'镜头穿过门、窗、人群或狭窄空间进入下一个画面。',
 '低机位 Dolly In 前推':'镜头贴近地面向前推，人物会显得更强、更有压迫感。',
 '后拉揭示 Dolly Out':'镜头慢慢后退，逐渐露出更大的环境和隐藏信息。',
 '斯坦尼康稳定跟拍 Steadicam Follow':'镜头平稳跟着人物走，画面流畅但有现场感。',
 '升降运镜 Crane Up/Down':'镜头向上或向下移动，用来展示空间大小和人物位置。',
 '横移平移 Tracking / Truck':'镜头向左或右平移，适合展示人物关系和空间变化。',
 '慢滚旋转 Dutch Roll':'镜头慢慢转斜，不是快速旋转，适合表现不稳定和心理变化。'
}
type Shot={id:string;title:string;shotSize?:string;movement:string;prompt:string;transition:string;audit:string}
type TextTemplate={id:string;name:string;content:string}
const demo:Shot[]=[{id:'S01',title:'雨夜建立关系',shotSize:'远景 / Establishing Wide Shot',movement:'跟拍 · 手持感',prompt:'竖屏 9:16，都市情感短剧。远景建立镜头，24mm 广角，深夜雨街，女主穿黑色风衣走向餐厅玻璃窗。摄影机从侧后方低机位稳定跟拍，带轻微可控手持呼吸感；冷蓝雨夜与餐厅暖光形成对比。她停下，看见男友与陌生女性并肩而坐，最后一秒停在她的视线方向。',transition:'黑场淡入 → 动作剪切',audit:'通过：远景交代空间，结尾停在可承接的视线状态。'},{id:'S02',title:'主观确认',shotSize:'中景 / Medium Shot',movement:'POV 主观视角 · 焦点转移',prompt:'承接 S01 结尾。中景切入，以女主 POV 隔着带雨滴的玻璃观察室内，焦点从雨滴转移到交握的手，再转移到男友闪躲的眼神。镜头缓慢推近，保留雨声和模糊谈话。结尾锁定在交握的手上。',transition:'视线匹配切 → 声音桥接',audit:'通过：中景承载关系，POV 与焦点目标明确。'},{id:'S03',title:'情绪失衡',shotSize:'近景 / Close-up',movement:'希区柯克变焦 · 环绕运镜',prompt:'承接 S02 的视线方向，切回女主正面近景。50mm 镜头，摄影机围绕她左侧 90 度平滑环绕至正面，在确认真相瞬间使用一次克制的希区柯克变焦，背景轻微拉伸。她眼眶泛红却强忍泪水，压低声音说“原来是真的”。',transition:'硬切 → 情绪爆点硬切',audit:'通过：近景承载表演和台词，变焦只使用一次。'}]
const toTemplate=(shots:Shot[])=>shots.map(s=>`${s.id}｜${s.title}\n运镜：${s.movement}\n提示词：${s.prompt}\n转场：${s.transition}\n审核：${s.audit}`).join('\n\n')

function BailianConfigModal({ onClose }:{ onClose:()=>void }){
 const[key,setKey]=useState('');const[baseUrl,setBaseUrl]=useState('https://dashscope.aliyuncs.com/compatible-mode/v1');const[model,setModel]=useState('qwen-plus');const[message,setMessage]=useState('');const[working,setWorking]=useState(false)
 async function request(url:string){setWorking(true);setMessage('处理中…');try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,baseUrl,model})});const d=await r.json();setMessage(d.message||'操作完成。')}catch{setMessage('无法连接本地服务。')}finally{setWorking(false)}}
 return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">MODEL PROVIDER</div><h2>阿里云百炼配置</h2></div><button className="close" onClick={onClose}>×</button></div><p className="modal-copy">Key 仅发送到本机的 Next.js 服务端，保存到项目根目录 <code>.env.local</code>，页面不会回显或保存密钥。</p><label>API Key</label><input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder="请输入百炼 API Key" autoComplete="off"/><label>Base URL</label><input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)}/><label>模型名</label><input value={model} onChange={e=>setModel(e.target.value)}/><div className="config-actions"><button className="settings-btn" onClick={()=>request('/api/check-key')} disabled={working||!key.trim()}>检测连接</button><button className="primary config-save" onClick={()=>request('/api/save-config')} disabled={working||!key.trim()}>{working?'处理中…':'保存配置'}</button></div>{message&&<p className="config-message">{message}</p>}<p className="modal-note">保存后无需重启，新的配置会在下一次生成或模板改写时立即读取。</p></div></div>
}

export default function Home(){
 const{sceneCard,shotPlan,editorOpen,setEditorOpen,stylePresetId,durationModeId,activeDurationMode,overridesDirty,beginNewStoryline,applyGenerated,setAuditReports,getOverridesForRequest,auditReport,setActiveStylePreset,setCompiled,generatedAt,setGeneratedAt}=useStudioContext();
 const[idea,setIdea]=useState('女主在雨夜发现男友背叛，克制情绪后转身离开。');const[selected,setSelected]=useState(['跟拍','手持感','POV 主观视角','希区柯克变焦']);const[shots,setShots]=useState<Shot[]>(demo);const[busy,setBusy]=useState(false);const[notice,setNotice]=useState('本地演示模式：配置百炼 Key 后可调用 Qwen。');const[settings,setSettings]=useState(false);const[templatesOpen,setTemplatesOpen]=useState(false);const[tab,setTab]=useState<'image'|'video'>('image');const[imageTemplates,setImageTemplates]=useState<TextTemplate[]>([]);const[videoTemplates,setVideoTemplates]=useState<TextTemplate[]>([]);const[imageName,setImageName]=useState('');const[imageText,setImageText]=useState('');const[activeImage,setActiveImage]=useState('');const[imageChange,setImageChange]=useState('');const[imageResult,setImageResult]=useState('');const[imageBusy,setImageBusy]=useState(false);const[videoName,setVideoName]=useState('');const[videoText,setVideoText]=useState('');const[activeVideo,setActiveVideo]=useState('');const[videoChange,setVideoChange]=useState('');const[adaptBusy,setAdaptBusy]=useState(false)
 useEffect(()=>{try{setImageTemplates(JSON.parse(localStorage.getItem('short-drama-image-prompt-templates')||'[]'));setVideoTemplates(JSON.parse(localStorage.getItem('short-drama-video-templates')||'[]'))}catch{}},[])
 const putImages=(list:TextTemplate[])=>{setImageTemplates(list);localStorage.setItem('short-drama-image-prompt-templates',JSON.stringify(list))};const putVideos=(list:TextTemplate[])=>{setVideoTemplates(list);localStorage.setItem('short-drama-video-templates',JSON.stringify(list))};const currentImage=imageTemplates.find(t=>t.id===activeImage);const currentVideo=videoTemplates.find(t=>t.id===activeVideo)
 const toggle=(m:string)=>setSelected(s=>s.includes(m)?s.filter(x=>x!==m):[...s,m]);const selectedLabel=useMemo(()=>selected.join(' · ')||'尚未选择运镜',[selected])
 async function generate(){setBusy(true);setNotice('正在生成导演级分镜…');try{
  // 覆盖只在“本次确实编辑过”时下发；快照由 context 统一管理，
  // 并且服务端回传的 stylePreset 会被记录，用于确认风格预设真的进了 API 和最终提示词。
  const {sceneCardOverrides,shotPlanOverrides}=getOverridesForRequest();
  const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idea,movements:selected,stylePresetId,durationModeId,sceneCardOverrides,shotPlanOverrides})});
  const d=await r.json();
  if(d.shots?.length)setShots(d.shots);
  if(d.sceneCard)applyGenerated(d.sceneCard,d.shotPlan||[]);
  if(d.continuity)setAuditReports(d.continuity,d.continuityBefore||null);
  if(d.compiledText&&d.shots)setCompiled({format:d.format||'short_drama_10s_v1',compiledText:d.compiledText,shots:d.shots,overrideSummary:EMPTY_OVERRIDE_SUMMARY});
  setActiveStylePreset(d.stylePreset||null);
  setGeneratedAt(new Date().toLocaleTimeString('zh-CN'));
  if(d.sceneCard&&d.shotPlan)setEditorOpen(true);
  const intent=d.intentLabel?`剧情意图识别为「${d.intentLabel}」`:'';
  const covered=d.stylePresetId===stylePresetId?`风格预设「${d.stylePreset?.name||''}」已生效`:'';
  const mode=d.mode==='dashscope'?'已使用百炼生成':'已使用本地导演级结果（配置 Key 后可切换百炼）';
  setNotice([mode,`主角锁定为 ${d.lead||'当前角色'}`,intent,covered].filter(Boolean).join('；')+'。');
 }catch{setNotice('生成失败，已保留当前分镜。')}finally{setBusy(false)}}
 function startNewStoryline(){beginNewStoryline();setActiveStylePreset(null);setCompiled(null);setGeneratedAt(null);setIdea('');setNotice('已清除上一轮的场景卡覆盖，请输入新剧情。')}
 function saveImageTemplate(){const content=imageText.trim();if(!content)return;const item={id:crypto.randomUUID(),name:imageName.trim()||`图片提示词模板 ${imageTemplates.length+1}`,content};putImages([...imageTemplates,item]);setActiveImage(item.id);setImageName('');setImageText('');setNotice(`已保存图片提示词模板“${item.name}”。`)}
 function saveVideoTemplate(){const content=videoText.trim()||toTemplate(shots);const item={id:crypto.randomUUID(),name:videoName.trim()||`视频提示词模板 ${videoTemplates.length+1}`,content};putVideos([...videoTemplates,item]);setActiveVideo(item.id);setVideoName('');setVideoText('');setNotice(`已保存视频提示词模板“${item.name}”。`)}
 async function adaptImage(){if(!currentImage||!imageChange.trim())return;setImageBusy(true);setImageResult('');try{const r=await fetch('/api/adapt-image-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:currentImage.content,change:imageChange})});const d=await r.json();setImageResult(r.ok&&d.prompt?d.prompt:`改写未执行：${d.message||'未知错误。'}`)}catch{setImageResult('改写未执行：无法连接本地服务。')}finally{setImageBusy(false)}}
 async function adaptVideo(){if(!currentVideo||!videoChange.trim())return;setAdaptBusy(true);setNotice('正在按视频提示词模板改编…');try{const r=await fetch('/api/adapt-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template:currentVideo.content,change:videoChange})});const d=await r.json();if(d.shots?.length){setShots(d.shots);setTemplatesOpen(false);setNotice(d.mode==='dashscope'?'已按视频提示词模板完成改编。':'已按模板生成本地改编结果；配置百炼后会更精细。')}}catch{setNotice('模板改编失败。')}finally{setAdaptBusy(false)}}
 const remove=(id:string,kind:'image'|'video')=>{if(kind==='image'){putImages(imageTemplates.filter(t=>t.id!==id));if(activeImage===id)setActiveImage('')}else{putVideos(videoTemplates.filter(t=>t.id!==id));if(activeVideo===id)setActiveVideo('')}}
 // 模板只存在浏览器 localStorage，不随代码仓库迁移；导出/导入是换机器唯一不丢模板的通道。
 const[templateMsg,setTemplateMsg]=useState('')
 function exportTemplates(){
  const payload={version:1,exportedAt:new Date().toISOString(),image:imageTemplates,video:videoTemplates}
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))
  const a=document.createElement('a');a.href=url;a.download=`短剧模板库-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url)
  setTemplateMsg(`已导出 ${imageTemplates.length} 个图片模板、${videoTemplates.length} 个视频模板。`)
 }
 function importTemplates(file:File){
  const reader=new FileReader()
  reader.onload=()=>{
   try{
    const d=JSON.parse(String(reader.result)) as {image?:unknown;video?:unknown}
    const pick=(v:unknown):TextTemplate[]=>{
     if(!Array.isArray(v))return []
     return (v as Array<Record<string,unknown>>).filter(t=>typeof t?.id==='string'&&typeof t?.name==='string'&&typeof t?.content==='string').map(t=>({id:String(t.id),name:String(t.name),content:String(t.content)}))
    }
    const imgs=pick(d?.image);const vids=pick(d?.video)
    if(!imgs.length&&!vids.length){setTemplateMsg('导入失败：文件里没有可识别的模板。');return}
    // 按 id 合并，同 id 以导入文件为准，重复导入不会产生副本。
    const merge=(cur:TextTemplate[],inc:TextTemplate[])=>Array.from(new Map([...cur,...inc].map(t=>[t.id,t])).values())
    putImages(merge(imageTemplates,imgs));putVideos(merge(videoTemplates,vids))
    setTemplateMsg(`已导入 ${imgs.length} 个图片模板、${vids.length} 个视频模板（同 ID 已覆盖）。`)
   }catch{setTemplateMsg('导入失败：不是合法的模板文件。')}
  }
  reader.onerror=()=>setTemplateMsg('导入失败：无法读取该文件。')
  reader.readAsText(file)
 }
 return <main className="shell"><header className="topbar"><div><div className="eyebrow">SHORT DRAMA / DIRECTOR WORKBENCH</div><h1>短剧提示词工作台</h1></div><div className="top-actions"><div className="protocol">${activeDurationMode.seconds} 秒镜头块协议 <span>● 已启用</span></div><button className="settings-btn" onClick={()=>setTemplatesOpen(true)}>▣ 模板库</button><button className="settings-btn" onClick={()=>setSettings(true)}>⚙ 百炼配置</button></div></header><section className="grid"><aside className="panel input-panel"><div className="panel-title"><span>01</span><h2>创意输入</h2></div><StylePresetSelector/><DurationModeSelector/><label>简短剧情提示词</label><textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={7}/><div className="hint">女主、男主身份会作为角色锚点锁定；没有提到舞蹈时不会自动添加跳舞动作。</div><div className="row-actions"><button className="settings-btn" onClick={startNewStoryline}>＋ 开始新剧情（清除覆盖）</button>{editorOpen&&<button className="settings-btn" onClick={()=>setEditorOpen(false)}>收起场景卡面板</button>}</div><label className="space">电影级运镜选择</label><div className="chips">{moves.map(m=><button key={m} title={moveDescriptions[m]} className={selected.includes(m)?'chip active':'chip'} onClick={()=>toggle(m)}><span className="chip-name">{m}</span><small>{moveDescriptions[m]}</small></button>)}</div><div className="selection">已选：{selectedLabel}</div><button className="primary" onClick={generate} disabled={busy}>{busy?'生成中…':'生成导演级分镜'} <span>→</span></button><p className="notice">{notice}</p></aside><section className="panel storyboard"><div className="panel-title"><span>02</span><h2>连续分镜</h2><div className="count">{shots.length} 个镜头块 · 每段 ${activeDurationMode.seconds} 秒</div></div><div className="timeline">{shots.map((s,i)=><article className="shot" key={s.id}><div className="shot-head"><strong>{s.id}</strong><span>{activeDurationMode.seconds}.0s</span>{s.shotSize&&<b className="shot-size">{s.shotSize}</b>}<em>{s.movement}</em></div><h3>{s.title}</h3><p>{s.prompt}</p><div className="shot-foot"><span>转场：{s.transition}</span>{i<shots.length-1&&<span className="anchor">↳ 下一镜继承末帧状态</span>}</div></article>)}</div></section><aside className="panel audit"><div className="panel-title"><span>03</span><h2>连续性审核</h2></div><div className="score"><b>{auditReport?auditReport.score:'—'}</b><span>/ 100<br/>{auditReport?(auditReport.passed?'检查通过':'仍有待处理项'):'等待生成'}</span></div><p className="hint audit-meta">{auditReport?`检查项：${auditReport.checkedRules.length} 条 · 待关注 ${auditReport.issues.length} 项`:'点击生成后会显示真实的连续性评分'}{generatedAt?` · 最近生成 ${generatedAt}`:''}</p>{shots.map(s=><div className="audit-row" key={s.id}><span className="dot"/><div><strong>{s.id} · {s.title}</strong><p>{s.audit}</p></div></div>)}<button className="secondary" onClick={()=>navigator.clipboard?.writeText(toTemplate(shots))}>复制全部提示词</button></aside></section>
 {templatesOpen&&<div className="modal-backdrop" onClick={()=>setTemplatesOpen(false)}><div className="modal template-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">TEXT TEMPLATE LIBRARY</div><h2>模板库</h2></div><button className="close" onClick={()=>setTemplatesOpen(false)}>×</button></div><div className="tabs"><button className={tab==='image'?'tab active-tab':'tab'} onClick={()=>setTab('image')}>图片提示词模板库</button><button className={tab==='video'?'tab active-tab':'tab'} onClick={()=>setTab('video')}>视频提示词模板库</button></div><div className="template-io"><div className="template-io-row"><span>模板保存在本机浏览器（localStorage），不随代码仓库迁移；换电脑前请先导出。</span><button className="settings-btn" onClick={exportTemplates}>↓ 导出全部模板</button><label className="settings-btn file-label">↑ 导入模板<input type="file" accept="application/json,.json" onChange={e=>{const el=e.currentTarget;const f=el.files?.[0];if(f)importTemplates(f);el.value=''}}/></label></div>{templateMsg&&<p className="template-io-msg">{templateMsg}</p>}</div>{tab==='image'?<div className="template-grid"><section><h3>添加图片提示词模板</h3><input value={imageName} onChange={e=>setImageName(e.target.value)} placeholder="模板名称，例如：电影感女主肖像"/><textarea value={imageText} onChange={e=>setImageText(e.target.value)} rows={10} placeholder="输入固定的图片提示词模板，例如：电影感半身肖像，女主，黑色风衣，雨夜霓虹..."/><button className="secondary" onClick={saveImageTemplate}>保存图片提示词模板</button></section><section><h3>按图片模板改写</h3><select value={activeImage} onChange={e=>{setActiveImage(e.target.value);setImageResult('')}}><option value="">选择一个图片提示词模板</option>{imageTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>{currentImage&&<p className="template-preview">已选模板：{currentImage.content.slice(0,150)}… <button className="link-btn" onClick={()=>remove(currentImage.id,'image')}>删除</button></p>}<textarea value={imageChange} onChange={e=>setImageChange(e.target.value)} rows={5} placeholder="填写修改信息，例如：把女主改为 28 岁女律师，白色西装，保持原有雨夜、霓虹、近景构图和电影光影。"/><button className="primary" onClick={adaptImage} disabled={!currentImage||!imageChange.trim()||imageBusy}>{imageBusy?'改写中…':'生成图片提示词'} <span>→</span></button>{imageResult&&<><label className="result-label">改写结果</label><textarea readOnly value={imageResult} rows={8}/><button className="secondary" onClick={()=>navigator.clipboard?.writeText(imageResult)}>复制图片提示词</button></>}</section></div>:<div className="template-grid"><section><h3>添加视频提示词模板</h3><input value={videoName} onChange={e=>setVideoName(e.target.value)} placeholder="模板名称，例如：雨夜背叛"/><textarea value={videoText} onChange={e=>setVideoText(e.target.value)} rows={10} placeholder="粘贴完整视频提示词模板。留空则保存当前分镜结果。"/><button className="secondary" onClick={saveVideoTemplate}>保存视频提示词模板</button></section><section><h3>按视频模板改编</h3><select value={activeVideo} onChange={e=>setActiveVideo(e.target.value)}><option value="">选择一个视频提示词模板</option>{videoTemplates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>{currentVideo&&<p className="template-preview">已选模板：{currentVideo.content.slice(0,150)}… <button className="link-btn" onClick={()=>remove(currentVideo.id,'video')}>删除</button></p>}<textarea value={videoChange} onChange={e=>setVideoChange(e.target.value)} rows={5} placeholder="例如：把女主改成 28 岁女律师，场景改为雨夜天台；保留运镜、节奏和转场。"/><button className="primary" onClick={adaptVideo} disabled={!currentVideo||!videoChange.trim()||adaptBusy}>{adaptBusy?'改编中…':'按模板生成分镜'} <span>→</span></button></section></div>}</div></div>}
 {settings&&<BailianConfigModal onClose={()=>setSettings(false)}/>}</main>
}
