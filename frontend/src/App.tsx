import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { request } from './api'
import type { Detail, OwnDetail, Page, User } from './types'
import { Login } from './components/Login'
import { TaskRegistry } from './components/TaskRegistry'
import { TaskDetails } from './components/TaskDetails'
import { CreateTaskForm } from './components/CreateTaskForm'
import { RegistryFilters } from './components/RegistryFilters'

type Credentials = { user: User; password: string }

export default function App() {
  const [credentials,setCredentials]=useState<Credentials|null>(null)
  const [loginError,setLoginError]=useState('')
  const [loginBusy,setLoginBusy]=useState(false)
  async function login(user:User,password:string) {
    setLoginBusy(true);setLoginError('')
    try { await request<Page>(user,password,'/api/tasks?page=0');setCredentials({user,password}) }
    catch(e) { setLoginError(e instanceof Error?e.message:'Не удалось войти.') }
    finally { setLoginBusy(false) }
  }
  if(!credentials) return <Login onLogin={login} error={loginError} busy={loginBusy}/>
  return <Workspace key={credentials.user} credentials={credentials} onLogout={()=>{setCredentials(null);setLoginError('');setLoginBusy(false)}}/>
}

function Workspace({credentials,onLogout}:{credentials:Credentials;onLogout:()=>void}) {
  const [error,setError]=useState(''); const [listBusy,setListBusy]=useState(false); const [detailBusy,setDetailBusy]=useState(false); const [actionBusy,setActionBusy]=useState(false)
  const [data,setData]=useState<Page|null>(null); const [page,setPage]=useState(0); const [status,setStatus]=useState(''); const [problems,setProblems]=useState(false)
  const [revision,setRevision]=useState(0)
  const [selected,setSelected]=useState<string|null>(null); const [detail,setDetail]=useState<Detail|OwnDetail|null>(null); const [title,setTitle]=useState('')
  const creation=useRef<{title:string;key:string}|null>(null); const retryKeys=useRef<Record<string,{key:string;failure:number}>>({})
  const alive=useRef(false); const listSequence=useRef(0); const detailSequence=useRef(0)
  const operator=credentials.user==='operator'; const busy=detailBusy||actionBusy
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;listSequence.current++;detailSequence.current++}},[])
  const load=useCallback(async()=>{
    const sequence=++listSequence.current; setListBusy(true);setError('')
    try {const query=new URLSearchParams({page:String(page)});if(status)query.set('status',status)
      const result=await request<Page>(credentials.user,credentials.password,`${problems&&operator?'/api/operator/tasks/problems':'/api/tasks'}?${query}`)
      if(alive.current && sequence===listSequence.current)setData(result)
    } catch(e) {if(alive.current && sequence===listSequence.current)setError(e instanceof Error?e.message:'Не удалось загрузить задания.')}
    finally {if(alive.current && sequence===listSequence.current)setListBusy(false)}
  },[credentials,page,status,problems,operator,revision])
  useEffect(()=>{void load();return()=>{listSequence.current++}},[load])
  function changeList(change:()=>void){listSequence.current++;setData(null);setError('');change();setRevision(value=>value+1)}
  async function open(id:string) {
    const sequence=++detailSequence.current;setSelected(id);setDetail(null);setDetailBusy(true);setError('')
    try {const result=await request<Detail|OwnDetail>(credentials.user,credentials.password,operator?`/api/operator/tasks/${id}`:`/api/tasks/${id}`)
      if(alive.current && sequence===detailSequence.current)setDetail(result)
    } catch(e){if(alive.current && sequence===detailSequence.current)setError(e instanceof Error?e.message:'Не удалось открыть задание.')}
    finally{if(alive.current && sequence===detailSequence.current)setDetailBusy(false)}
  }
  function close(){detailSequence.current++;setSelected(null);setDetail(null);setDetailBusy(false);setError('')}
  async function create(event:FormEvent) {
    event.preventDefault();setActionBusy(true);setError('')
    try {if(!creation.current || creation.current.title!==title)creation.current={title,key:crypto.randomUUID()}
      const result=await request<OwnDetail>(credentials.user,credentials.password,'/api/tasks',{method:'POST',headers:{'Idempotency-Key':creation.current.key},body:JSON.stringify({title})})
      if(!alive.current)return;creation.current=null;setTitle('');await open(result.id);if(alive.current)setRevision(value=>value+1)
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Не удалось создать задание.')}
    finally{if(alive.current)setActionBusy(false)}
  }
  async function mutate(path:string,options:RequestInit) {
    if(!selected)return;const id=selected;const sequence=detailSequence.current;setActionBusy(true);setError('')
    try {await request(credentials.user,credentials.password,path,options)
      if(alive.current && sequence===detailSequence.current){await open(id);if(alive.current)setRevision(value=>value+1)}
    }catch(e){if(alive.current && sequence===detailSequence.current)setError(e instanceof Error?e.message:'Не удалось выполнить действие.')}
    finally{if(alive.current)setActionBusy(false)}
  }
  function logout(){alive.current=false;listSequence.current++;detailSequence.current++;onLogout()}
  return <><header className="topbar"><div className="container topbar-inner"><div><strong className="brand">Обмен заданий</strong><span className="topbar-subtitle">Рабочее пространство</span></div><div className="row"><span>{operator?'Оператор':`Инициатор: ${credentials.user}`}</span><button className="button" onClick={logout}>Выйти</button></div></div></header>
    <main className="container main-stack"><div className="page-heading"><div><p className="muted">Обзор и управление</p><h1>{operator?'Рабочая консоль':'Мои задания'}</h1><p className="muted">{operator?'Контролируйте доставку и результаты обмена.':'Создавайте задания и следите за исполнением.'}</p></div></div>
      {error && <div className="notice notice--error" role="alert">{error} {selected && <button className="link-button" onClick={()=>void open(selected)}>Обновить данные</button>}</div>}
      {selected ? detail ? <TaskDetails key={selected} detail={detail} operator={operator} busy={busy} onClose={close} onRefresh={()=>void open(selected)} onReconcile={()=>void mutate(`/api/operator/tasks/${selected}/reconcile`,{method:'POST'})} onApply={id=>{if(window.confirm('Принять внешний результат?'))void mutate(`/api/operator/tasks/${selected}/reconciliations/${id}/apply`,{method:'POST'})}} onRetry={()=>{const history=(detail as Detail).history;const failure=history.filter(e=>['AMBIGUOUS_RETRY','LAST_LEASE_EXPIRED','INVALID_RESULT_REQUIRES_REVIEW','RESULT_CONFLICT','RESULT_CONFLICT_REQUIRES_REVIEW'].includes(e.event)).at(-1)?.id ?? 0;const previous=retryKeys.current[selected];if(!previous || previous.failure!==failure)retryKeys.current[selected]={key:crypto.randomUUID(),failure};void mutate(`/api/operator/tasks/${selected}/retry`,{method:'POST',headers:{'Idempotency-Key':retryKeys.current[selected].key}})}} onAssign={(assignee,version)=>void mutate(`/api/tasks/${selected}/assignee`,{method:'PATCH',body:JSON.stringify({assignee,version})})} /> : <section className="surface detail">{detailBusy?<p role="status">Загрузка карточки…</p>:<button className="button" onClick={close}>К реестру</button>}</section> : <>
      {!operator && <CreateTaskForm title={title} busy={busy} onChange={setTitle} onSubmit={create}/>}
      <section className="surface registry"><div className="section-head"><div><h2>{problems?'Проблемы обмена':'Реестр заданий'}</h2><p className="muted">Доставка и исполнение отслеживаются отдельно.</p></div>{operator && <div className="tabs"><button className={problems?'button':'button button--selected'} onClick={()=>changeList(()=>{setProblems(false);setPage(0)})}>Все задания</button><button className={problems?'button button--selected':'button'} onClick={()=>changeList(()=>{setProblems(true);setPage(0)})}>Проблемы</button></div>}</div><RegistryFilters status={status} busy={listBusy} onStatus={value=>changeList(()=>{setStatus(value);setPage(0)})} onRefresh={()=>void load()}/>{listBusy && <p className="muted" role="status">Загрузка…</p>}{data && <TaskRegistry data={data} onOpen={id=>void open(id)} onPage={value=>changeList(()=>setPage(value))}/>}</section></>}
    </main></>
}
