const { chromium } = require('playwright')
const assert = require('node:assert/strict')

function deferred() { let resolve; const promise=new Promise(r=>{resolve=r}); return {promise,resolve} }
function row(id,title,status='PENDING') { return {id,title,owner_name:id==='bob-id'?'bob':'alice',assignee:null,local_version:0,business_status:status,delivery_state:'READY',created_at:'2026-01-01T00:00:00Z',failure_reason:null} }
async function login(page,user,password) { await page.getByLabel('Пользователь').selectOption(user);await page.getByLabel('Пароль').fill(password);await page.getByRole('button',{name:'Войти'}).click();await page.getByRole('heading',{name:'Мои задания'}).waitFor() }
async function run() {
 const browser=await chromium.launch({headless:true,executablePath:process.env.TASK3_BROWSER||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'})
 try {
  for(const oldError of [false,true]) {
   const context=await browser.newContext({viewport:{width:390,height:900}});const page=await context.newPage()
   const entered=deferred(), release=deferred(), delivered=deferred()
   await context.route('**/api/**',async route=>{
    const req=route.request(), url=new URL(req.url());const user=Buffer.from((req.headers().authorization||'').split(' ')[1]||'','base64').toString().split(':')[0]
    if(url.pathname==='/api/tasks/alice-id'){entered.resolve();await release.promise;await route.fulfill(oldError?{status:500,json:{message:'Ошибка Алисы'}}:{json:{id:'alice-id',title:'Секрет Алисы',status:'PENDING',version:0}});delivered.resolve();return}
    if(url.pathname==='/api/tasks'){await route.fulfill({json:{items:[user==='bob'?row('bob-id','Задание Боба'):row('alice-id','Секрет Алисы')],page:0,hasNext:false}});return}
    await route.fulfill({status:404,json:{}})
   })
   await page.goto('http://127.0.0.1:5173/');await login(page,'alice','demo-alice')
   await page.getByLabel('Название задания').fill('черновик Алисы')
   await page.getByRole('button',{name:'Секрет Алисы'}).filter({visible:true}).click();await entered.promise
   await page.getByRole('button',{name:'Выйти'}).click();await login(page,'bob','demo-bob')
   await page.getByRole('button',{name:'Задание Боба'}).filter({visible:true}).waitFor()
   const oldResponse=page.waitForResponse(response=>response.url().includes('/api/tasks/alice-id'))
   release.resolve();await oldResponse;await delivered.promise
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   assert.equal(await page.getByLabel('Название задания').inputValue(),'')
   assert.equal(await page.getByText('Секрет Алисы').count(),0)
   assert.equal(await page.getByRole('alert').count(),0)
   assert.equal(await page.getByLabel('Статус исполнения').inputValue(),'')
   await context.close()
  }
  for(const oldError of [false,true]) {
   const context=await browser.newContext();const page=await context.newPage()
   const entered=deferred(), release=deferred(), delivered=deferred()
   await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url());const status=url.searchParams.get('status')
    if(status==='PENDING'){entered.resolve();await release.promise;await route.fulfill(oldError?{status:500,json:{message:'Старая ошибка'}}:{json:{items:[row('old','Старый фильтр')],page:0,hasNext:false}});delivered.resolve();return}
    await route.fulfill({json:{items:[status==='SUCCEEDED'?row('new','Новый фильтр','SUCCEEDED'):row('initial','Первый список')],page:0,hasNext:false}})
   })
   await page.goto('http://127.0.0.1:5173/');await login(page,'alice','demo-alice')
   await page.getByRole('button',{name:'Первый список'}).filter({visible:true}).waitFor()
   await page.getByLabel('Статус исполнения').selectOption('PENDING');await entered.promise
   await page.getByLabel('Статус исполнения').selectOption('SUCCEEDED')
   await page.getByRole('button',{name:'Новый фильтр'}).filter({visible:true}).waitFor()
   const oldResponse=page.waitForResponse(response=>new URL(response.url()).searchParams.get('status')==='PENDING')
   release.resolve();await oldResponse;await delivered.promise
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   assert.equal(await page.getByLabel('Статус исполнения').inputValue(),'SUCCEEDED')
   assert.equal(await page.getByRole('button',{name:'Старый фильтр'}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Новый фильтр'}).filter({visible:true}).count(),1)
   assert.equal(await page.getByRole('alert').count(),0)
   await context.close()
  }
  {
   const context=await browser.newContext();const page=await context.newPage();const keys=[]
   await context.route('**/api/**',async route=>{
    const request=route.request(), path=new URL(request.url()).pathname
    if(path==='/api/tasks' && request.method()==='POST') {
     keys.push(request.headers()['idempotency-key']);if(keys.length===1){await route.abort('failed');return}
     await route.fulfill({json:{id:'created-id',title:'Повтор создания',status:'PENDING',version:0}});return
    }
    if(path==='/api/tasks/created-id'){await route.fulfill({json:{id:'created-id',title:'Повтор создания',status:'PENDING',version:0}});return}
    await route.fulfill({json:{items:[],page:0,hasNext:false}})
   })
   await page.goto('http://127.0.0.1:5173/');await login(page,'alice','demo-alice')
   await page.getByLabel('Название задания').fill('Повтор создания');await page.getByRole('button',{name:'Создать задание'}).click();await page.getByRole('alert').waitFor()
   await page.getByRole('button',{name:'Создать задание'}).click();await page.getByRole('heading',{name:'Повтор создания'}).waitFor()
   assert.equal(keys.length,2);assert.ok(keys[0]);assert.equal(keys[0],keys[1]);await context.close()
  }
  {
   const context=await browser.newContext();const page=await context.newPage();const keys=[];const completed=deferred()
   const item=row('retry-id','Повтор доставки')
   await context.route('**/api/**',async route=>{
    const request=route.request(), path=new URL(request.url()).pathname
    if(path.endsWith('/retry')){keys.push(request.headers()['idempotency-key']);if(keys.length===1){await route.abort('failed');return}await route.fulfill({json:{scheduled:true}});completed.resolve();return}
    if(path==='/api/operator/tasks/retry-id'){await route.fulfill({json:{...item,result_version:0,attempts:1,lease_until:null,recovery_pending:false,history:[],conflicts:[],reconciliations:[],assignmentHistory:[]}});return}
    await route.fulfill({json:{items:[item],page:0,hasNext:false}})
   })
   await page.goto('http://127.0.0.1:5173/');await page.getByLabel('Пользователь').selectOption('operator');await page.getByLabel('Пароль').fill('demo-operator');await page.getByRole('button',{name:'Войти'}).click()
   await page.getByRole('button',{name:'Повтор доставки'}).filter({visible:true}).click()
   await page.getByRole('button',{name:'Повторить доставку'}).click();await page.getByRole('alert').waitFor()
   await page.getByRole('button',{name:'Повторить доставку'}).click()
   await completed.promise
   await page.waitForFunction(()=>!document.querySelector('[role="alert"]'))
   assert.equal(keys.length,2);assert.ok(keys[0]);assert.equal(keys[0],keys[1]);await context.close()
  }
   {
    const context=await browser.newContext();const page=await context.newPage();const keys=[];const completed=deferred()
    const item=row('conflict-retry-id','Повтор после конфликта')
    const history=[{id:41,event:'RESULT_CONFLICT_REQUIRES_REVIEW',actor:'executor',created_at:'2026-01-01T00:00:00Z'}]
    await context.route('**/api/**',async route=>{
     const request=route.request(), path=new URL(request.url()).pathname
     if(path.endsWith('/retry')) {
      keys.push(request.headers()['idempotency-key'])
      if(keys.length===1) {
       history.push({id:42,event:'RESULT_CONFLICT_REQUIRES_REVIEW',actor:'executor',created_at:'2026-01-01T00:00:01Z'})
       await route.fulfill({json:{operationId:item.id,scheduled:true}});return
      }
      if(keys.length===2){await route.abort('failed');return}
      await route.fulfill({json:{operationId:item.id,scheduled:true}});completed.resolve();return
     }
     if(path==='/api/operator/tasks/conflict-retry-id') {
      await route.fulfill({json:{...item,delivery_state:'REVIEW',failure_reason:'CONTRADICTORY_RESULT_BATCH',result_version:0,attempts:2,lease_until:null,recovery_pending:false,history:[...history],conflicts:[{id:1,reason:'CONTRADICTORY_RESULT_BATCH',current_version:0,incoming_version:1}],reconciliations:[],assignmentHistory:[]}});return
     }
     await route.fulfill({json:{items:[item],page:0,hasNext:false}})
    })
    await page.goto('http://127.0.0.1:5173/');await page.getByLabel('Пользователь').selectOption('operator');await page.getByLabel('Пароль').fill('demo-operator');await page.getByRole('button',{name:'Войти'}).click()
    await page.getByRole('button',{name:item.title}).filter({visible:true}).click()
    await page.getByText('Противоречивый ответ требует разбора').first().waitFor()
    const retry=page.getByRole('button',{name:'Повторить доставку'})
    await retry.click()
    await page.getByText('Противоречивый ответ требует разбора').nth(1).waitFor()
    await retry.click();await page.getByRole('alert').waitFor()
    await retry.click();await completed.promise;await page.waitForFunction(()=>!document.querySelector('[role="alert"]'))
    assert.equal(keys.length,3);assert.ok(keys[0]);assert.ok(keys[1]);assert.notEqual(keys[1],keys[0]);assert.equal(keys[2],keys[1])
    console.log('session recovery: a new conflict gets a new idempotency key and network retry keeps it');await context.close()
   }
  {
   const context=await browser.newContext();const page=await context.newPage();let detailReads=0;let detailTitle='Карточка до polling';const listQueries=[]
   await context.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname
    if(path==='/api/tasks/session-task'){
     detailReads++
     await route.fulfill({json:{id:'session-task',title:detailTitle,status:'PENDING',version:detailReads}});return
    }
    if(path==='/api/tasks'&&route.request().method()==='GET'){
     const query={status:url.searchParams.get('status')||'',page:url.searchParams.get('page')||'0'};listQueries.push(query)
     const status=query.status==='SUCCEEDED'?'SUCCEEDED':'PENDING'
     await route.fulfill({json:{items:[row('session-task','Задание для проверки маршрута',status)],page:Number(query.page),hasNext:true}});return
    }
    if(path==='/api/operator/tasks/problems'){
     const query={status:url.searchParams.get('status')||'',page:url.searchParams.get('page')||'0'};listQueries.push(query)
     await route.fulfill({json:{items:[row('problem-route','Проблемное задание','FAILED')],page:Number(query.page),hasNext:false}});return
    }
    await route.fulfill({status:404,json:{message:'Unexpected test request'}})
   })
   await page.goto('http://127.0.0.1:5173/tasks');await login(page,'alice','demo-alice')
   assert.ok(await page.evaluate(()=>sessionStorage.length>0),'successful login should survive a reload in this tab')
   await page.getByRole('button',{name:'Задание для проверки маршрута'}).filter({visible:true}).click()
   await page.getByRole('heading',{name:'Карточка до polling'}).waitFor()
   assert.equal(new URL(page.url()).pathname,'/tasks/session-task')
   const readsBeforePoll=detailReads;detailTitle='Карточка обновлена при polling'
   await page.waitForTimeout(5400)
   assert.ok(detailReads>readsBeforePoll,'selected task should be reloaded on the five-second interval')
   await page.getByRole('heading',{name:'Карточка обновлена при polling'}).waitFor()
   await page.reload()
   await page.getByRole('heading',{name:'Карточка обновлена при polling'}).waitFor()
   assert.equal(new URL(page.url()).pathname,'/tasks/session-task')
   await page.goBack()
   await page.getByRole('heading',{name:'Мои задания'}).waitFor()
   const readsAfterClose=detailReads;await page.waitForTimeout(5200)
   assert.equal(detailReads,readsAfterClose,'detail polling must stop after returning to the registry')
   await page.getByLabel('Статус исполнения').selectOption('SUCCEEDED')
   await page.getByRole('button',{name:'Задание для проверки маршрута'}).filter({visible:true}).waitFor()
   assert.equal(new URL(page.url()).searchParams.get('status'),'SUCCEEDED')
   await page.getByRole('button',{name:'Далее'}).click()
   assert.equal(new URL(page.url()).searchParams.get('page'),'1')
   const listReadsBeforePoll=listQueries.length;await page.waitForTimeout(5400)
   assert.ok(listQueries.length>listReadsBeforePoll,'registry should reload on the five-second interval')
   assert.deepEqual(listQueries.at(-1),{status:'SUCCEEDED',page:'1'},'registry polling must keep the active filter and page')
   await page.goBack()
   assert.equal(new URL(page.url()).searchParams.get('status'),'SUCCEEDED')
   assert.ok(['0',null].includes(new URL(page.url()).searchParams.get('page')))
   await page.goForward()
   assert.equal(new URL(page.url()).searchParams.get('page'),'1')
   await page.getByRole('button',{name:'Выйти'}).click()
   assert.equal(await page.evaluate(()=>sessionStorage.length),0,'logout should clear the saved credentials')
   await page.getByLabel('Пользователь').selectOption('operator');await page.getByLabel('Пароль').fill('demo-operator');await page.getByRole('button',{name:'Войти'}).click()
   await page.getByRole('heading',{name:'Рабочая консоль'}).waitFor()
   await page.getByRole('button',{name:'Проблемы',exact:true}).click()
   assert.equal(new URL(page.url()).pathname,'/tasks/problems')
   await page.reload()
   await page.getByRole('heading',{name:'Проблемы обмена'}).waitFor()
   assert.equal(new URL(page.url()).pathname,'/tasks/problems')
   await page.getByRole('button',{name:'Выйти'}).click()
   assert.equal(await page.evaluate(()=>sessionStorage.length),0,'operator logout should also clear the saved credentials')
   console.log('routes/session/polling: direct task route, reload, history, session restore, filtered registry and detail polling passed')
   await context.close()
  }
  for(const width of [390,1440]) {
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const title='Я'.repeat(200)
   await context.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    await route.fulfill({json:path==='/api/tasks'?{items:[row('long-id',title)],page:0,hasNext:false}:{id:'long-id',title,status:'PENDING',version:0}})
   })
   await page.goto('http://127.0.0.1:5173/');await login(page,'alice','demo-alice')
   const link=page.getByRole('button',{name:title}).filter({visible:true});await link.waitFor();await link.focus();await page.keyboard.press('Enter')
   await page.getByRole('heading',{name:title}).waitFor()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
   await page.getByRole('button',{name:'К реестру'}).focus();await page.keyboard.press('Enter')
   await link.waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
   if(width===1440) assert.equal(await page.locator('.table-wrap').evaluate(element=>element.scrollWidth<=element.clientWidth),true)
   console.log(`session and wrapping: width ${width} passed`);await context.close()
  }
 } finally { await browser.close() }
}
run().catch(error=>{console.error(error);process.exitCode=1})
