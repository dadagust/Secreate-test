const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

async function lossFixture(page, width, label) {
  const operator='Basic '+Buffer.from('operator:demo-operator').toString('base64')
  const alice='Basic '+Buffer.from('alice:demo-alice').toString('base64')
  const title=`${label} ${width} ${Date.now()}`
  assert.equal((await page.request.post('http://127.0.0.1:9090/fault/drop-next')).status(),204)
  const created=await page.request.post('http://127.0.0.1:5173/api/tasks',{headers:{Authorization:alice,'Idempotency-Key':require('node:crypto').randomUUID()},data:{title}})
  assert.equal(created.status(),200)
  const {id}=await created.json()
  assert.match(id,/^[0-9a-f-]{36}$/)
  let lost=false
  for(let attempt=0;attempt<80;attempt++) {
    const response=await page.request.get(`http://127.0.0.1:5173/api/operator/tasks/${id}`,{headers:{Authorization:operator}})
    const state=await response.json()
    if(state.history.some(event=>event.event==='AMBIGUOUS_RETRY')) {lost=true;break}
    await page.waitForTimeout(100)
  }
  assert.equal(lost,true,'emulator response was lost after execution')
  execFileSync('docker',['exec',process.env.TASK3_POSTGRES_CONTAINER,'psql','-U','exchange','-d','exchange','-c',`update outbox set next_attempt=now()+interval '1 day' where task_id='${id}' and state='READY'`],{stdio:'ignore'})
  return {id,title,operator}
}

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TASK3_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
  try {
    for (const width of [390, 1440]) {
      const context=await browser.newContext({ viewport: { width, height: 900 } })
      const page=await context.newPage()
      const title=(`Задание${width}${Date.now()}`).padEnd(200,'Я')
      await page.goto('http://127.0.0.1:5173/')
      await page.getByLabel('Пользователь').waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SELECT')
      assert.equal(await page.evaluate(() => document.activeElement?.matches(':focus-visible')), true)
      await page.keyboard.press('Tab')
      await page.keyboard.type('demo-alice')
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter')
      await page.getByRole('heading', {name:'Мои задания'}).waitFor()
      await page.locator('button:enabled').filter({hasText:'Создать задание'}).waitFor()
      await page.getByLabel('Название задания').fill(title)
      await page.getByLabel('Название задания').press('Tab'); await page.keyboard.press('Enter')
      await page.getByRole('heading',{name:title}).waitFor()
      await page.getByRole('button',{name:'К реестру'}).focus(); await page.keyboard.press('Enter')
      await page.getByRole('button',{name:'Выйти'}).focus(); await page.keyboard.press('Enter')
      await page.getByLabel('Пользователь').selectOption('operator')
      await page.getByLabel('Пароль').fill('demo-operator')
      await page.getByRole('button',{name:'Войти'}).focus(); await page.keyboard.press('Enter')
      await page.getByRole('heading',{name:'Рабочая консоль'}).waitFor()
      await page.locator('.registry').waitFor()
      await page.getByRole('button',{name:'Проблемы'}).focus(); await page.keyboard.press('Enter')
      await page.getByRole('heading',{name:'Проблемы обмена'}).waitFor()
      await page.getByRole('button',{name:'Все задания'}).focus(); await page.keyboard.press('Enter')
      const task=page.getByRole('button',{name:title}).filter({visible:true})
      await task.waitFor()
      assert.equal(await page.locator('.table-wrap').isVisible(),width===1440)
      assert.equal(await page.locator('.mobile-list').isVisible(),width===390)
      if(width===1440) assert.equal(await page.locator('.table-wrap').evaluate(element=>element.scrollWidth<=element.clientWidth),true)
      await task.focus(); await page.keyboard.press('Enter')
      await page.getByRole('heading',{name:title}).waitFor()
      const taskId=(await page.locator('.identifier').innerText()).trim()
      const operatorAuth='Basic '+Buffer.from('operator:demo-operator').toString('base64')
      let delivered=false
      for(let attempt=0;attempt<40;attempt++) {
        const response=await page.request.get(`http://127.0.0.1:5173/api/operator/tasks/${taskId}`,{headers:{Authorization:operatorAuth}})
        const state=await response.json()
        if(state.delivery_state==='DONE') { delivered=true;break }
        await page.waitForTimeout(250)
      }
      assert.equal(delivered,true,'delivery should finish before reconciliation')
      await page.getByRole('button',{name:'Обновить',exact:true}).click()
      await page.locator('button:enabled').filter({hasText:'Сверить результат'}).waitFor()
      await page.getByRole('button',{name:'Сверить результат'}).focus(); await page.keyboard.press('Enter')
      await page.getByText('Внешний результат:',{exact:false}).first().waitFor()
      await page.getByLabel('Новый ответственный').selectOption('operator')
      await page.locator('button:enabled').filter({hasText:'Назначить'}).waitFor()
      await page.getByRole('button',{name:'Назначить'}).focus(); await page.keyboard.press('Enter')
      await page.getByText('Ответственный: operator').waitFor()
      await page.locator('button:enabled').filter({hasText:'Назначить'}).waitFor()
      const id=(await page.locator('.identifier').innerText()).trim()
      const authorization='Basic '+Buffer.from('operator:demo-operator').toString('base64')
      const current=await page.request.get(`http://127.0.0.1:5173/api/operator/tasks/${id}`,{headers:{Authorization:authorization}})
      const state=await current.json()
      const changed=await page.request.patch(`http://127.0.0.1:5173/api/tasks/${id}/assignee`,{headers:{Authorization:authorization},data:{assignee:'alice',version:state.local_version}})
      assert.equal(changed.status(),200)
      await page.getByRole('button',{name:'Назначить'}).focus(); await page.keyboard.press('Enter')
      await page.getByRole('alert').waitFor()
      assert.match(await page.getByRole('alert').innerText(),/изменились|обнов/i)
      await page.getByRole('button',{name:'Обновить данные'}).focus(); await page.keyboard.press('Enter')
      await page.getByText('Ответственный: alice').waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(),`task3-console-${width}.png`), fullPage: true })
      if(process.env.TASK3_POSTGRES_CONTAINER) {
        for(const action of ['apply','retry']) {
          const fixture=await lossFixture(page,width,action==='apply'?'Сверка':'Восстановление')
          await page.getByRole('button',{name:'К реестру'}).click()
          await page.locator('button:enabled').filter({hasText:'Обновить'}).first().click()
          const entry=page.getByRole('button',{name:fixture.title}).filter({visible:true})
          await entry.waitFor();await entry.focus();await page.keyboard.press('Enter')
          await page.getByRole('heading',{name:fixture.title}).waitFor()
          await page.locator('button:enabled').filter({hasText:'Сверить результат'}).waitFor()
          if(action==='apply') {
            await page.getByRole('button',{name:'Сверить результат'}).focus();await page.keyboard.press('Enter')
            await page.getByText('Расхождение',{exact:true}).first().waitFor()
            page.once('dialog',dialog=>dialog.accept())
            await page.locator('button:enabled').filter({hasText:'Принять внешний результат'}).waitFor()
            await page.getByRole('button',{name:'Принять внешний результат'}).focus();await page.keyboard.press('Enter')
          } else {
            await page.locator('button:enabled').filter({hasText:'Повторить доставку'}).waitFor()
            await page.getByRole('button',{name:'Повторить доставку'}).focus();await page.keyboard.press('Enter')
          }
          let done=false
          for(let attempt=0;attempt<80;attempt++) {
            const result=await page.request.get(`http://127.0.0.1:5173/api/operator/tasks/${fixture.id}`,{headers:{Authorization:fixture.operator}})
            if((await result.json()).business_status==='SUCCEEDED'){done=true;break}
            await page.waitForTimeout(100)
          }
          assert.equal(done,true,`${action} should apply a result`)
          const external=await page.request.get(`http://127.0.0.1:9090/operations/${fixture.id}`)
          assert.equal((await external.json()).executions,1)
        }
      }
      console.log(`width ${width}: initiator and operator keyboard scenarios passed`)
      await context.close()
    }
  } finally { await browser.close() }
}
run().catch(error => { console.error(error); process.exitCode=1 })
