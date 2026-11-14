import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createScreenHistory, readScreenEntry} from '../src/screenHistory.ts'

function setup(address='https://wall.test/') {
  const entries=[{address:'https://outside.test/',state:null},{address,state:{other:'preserved'}}],listeners=new Set()
  let index=1,display='home',restored
  const history={
    get state(){return entries[index].state},
    pushState(state,_unused,url){entries.splice(++index);entries.push({address:String(url),state})},
    replaceState(state,_unused,url){entries[index]={address:String(url),state}},
    back(){this.go(-1)},
    go(delta){index+=delta;assert(index>=0&&index<entries.length);for(const listener of listeners)listener(this.state)},
  }
  const options={history,url:()=>new URL(entries[index].address),capture:()=>display,
    restore:(entry,snapshot)=>{restored=entry;display=snapshot??entry.screen},
    listen:listener=>{listeners.add(listener);return()=>listeners.delete(listener)}}
  let nav=createScreenHistory(options);nav.restore()
  return {history,entries,get index(){return index},get nav(){return nav},get display(){return display},
    set display(value){display=value},get restored(){return restored},reload(){nav.dispose();nav=createScreenHistory(options);nav.restore()}}
}
test('Back and Forward restore the preceding Explore screen and its cached display',()=>{
 const app=setup();app.nav.push({screen:'explore'});app.display='Explore with more routes and scroll position'
 app.nav.push({screen:'route',routeId:'r1'});app.display='Route one'
 app.history.back();assert.equal(app.restored.screen,'explore');assert.equal(app.display,'Explore with more routes and scroll position')
 app.history.go(1);assert.equal(app.restored.routeId,'r1');assert.equal(app.display,'Route one')
 app.nav.home();assert.equal(app.index,1);assert.equal(app.restored.screen,'home')
 app.history.back();assert.equal(app.index,0,'Back at Home can leave the app normally')
})
test('shared route bootstraps an in-app Home and reload does not duplicate entries',()=>{
 const app=setup('https://wall.test/?route=shared&wallVersion=v4')
 assert.equal(app.entries.length,3);assert.equal(app.restored.screen,'route');assert.equal(app.restored.routeId,'shared')
 app.reload();assert.equal(app.entries.length,3)
 app.history.back();assert.equal(app.restored.screen,'home');assert(!new URL(app.entries[app.index].address).searchParams.has('route'))
 assert.equal(new URL(app.entries[app.index].address).searchParams.get('wallVersion'),'v4')
})
test('drafts stay in memory and are captured when browser Back leaves the editor',()=>{
 const app=setup();app.nav.push({screen:'editor'});app.display='Private draft title and hold selection'
 app.history.back();app.history.go(1)
 assert.equal(app.display,'Private draft title and hold selection')
 assert(!JSON.stringify(app.entries).includes('Private draft'))
})
test('saving replaces the editor entry and same-screen actions do not add duplicates',()=>{
 const app=setup();app.nav.push({screen:'editor'});const length=app.entries.length
 app.nav.push({screen:'editor'});assert.equal(app.entries.length,length)
 app.nav.replace({screen:'route',routeId:'saved'});assert.equal(app.entries.length,length)
 assert.equal(app.nav.current.depth,1);app.history.back();app.history.go(1)
 assert.equal(app.restored.screen,'route');assert.equal(app.restored.routeId,'saved')
 assert.equal(app.history.state.other,'preserved')
})
test('rejects malformed navigation state and disposes its popstate listener',()=>{
 assert.equal(readScreenEntry(null),null)
 assert.equal(readScreenEntry({stonehamScreenV1:{screen:'route',id:'x',root:'x',depth:1}}),null)
 const app=setup();app.nav.push({screen:'explore'});app.display='Still visible'
 app.nav.dispose();app.history.back();assert.equal(app.display,'Still visible')
})
