// Completely offline: fake achievement conditions, no upstream requests.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const directory=path.resolve(__dirname,'../public/experiments/mame-ra');
async function load(name, options={}) {
 const context=vm.createContext({module:{exports:{}},exports:{},require,__dirname:directory,__filename:path.join(directory,name+'.js'),process,console,TextDecoder,TextEncoder,setTimeout,clearTimeout,performance});
 vm.runInContext(fs.readFileSync(path.join(directory,name+'.js'),'utf8'),context);
 return context.module.exports({wasmBinary:fs.readFileSync(path.join(directory,name+'.wasm')),print(){},printErr(){},...options});
}
test('Pac-Man spectator evaluates mapped RAM locally and never submits play or awards',async()=>{
 let client,snapshot;const requests=[],events=[];const ram=new Map([[0x66e,0]]);
 client=await load('rc-client',{
  readMemory(address,length){const b=new Uint8Array(length);for(let i=0;i<length;i++){if(!ram.has(address+i))return null;b[i]=ram.get(address+i);}return b;},
  onSnapshot(value){snapshot=value;},onEvent(event){events.push(event);},
  serverCall(url,body,callback,userdata){const p=new URLSearchParams(body);requests.push(p);let response;
   if(p.get('r')==='login2')response={Success:true,User:'FixtureUser',Token:'fixture-token',Score:0,SoftcoreScore:0};
   else if(p.get('r')==='achievementsets'){
    assert.equal(p.get('m'),'64d1f88b9b276aece4b0edcc25b7a434');
    response={Success:true,GameId:12192,Title:'Offline Pac-Man fixture',ConsoleId:27,ImageIconUrl:'https://example.invalid/icon.png',RichPresenceGameId:12192,RichPresencePatch:'',Sets:[{AchievementSetId:1111,GameId:12192,Title:null,Type:'core',ImageIconUrl:'https://example.invalid/icon.png',Leaderboards:[],Achievements:[['Insert a coin','0xH066e=1'],['Unmapped RAM','0xH0000=1']].map(([Title,MemAddr],i)=>({ID:5501+i,Title,Description:'Offline fixture only',Flags:3,Points:5,MemAddr,Author:'Fixture',BadgeName:'00234',Created:1367266583,Modified:1376929305}))}]};
   }else throw new Error('Unexpected RPC action: '+p.get('r'));
   queueMicrotask(()=>{const b=Buffer.from(JSON.stringify(response)),ptr=client._malloc(b.length+1);client.HEAPU8.set(b,ptr);client.HEAPU8[ptr+b.length]=0;client._ra_reply(callback,userdata,200,ptr,b.length);client._free(ptr);});
  }
 });
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 client.cwrap('ra_login_token',null,['string','string'])('FixtureUser','fixture-token');await settle();
 assert.equal(client._ra_load_pacman(),1);await settle();await settle();
 assert.equal(events.find(e=>e.kind==='game')?.result,0);
 client._ra_frame();client._ra_snapshot();assert.equal(snapshot.items.find(a=>a.id===5502).state,3);
 ram.set(0x66e,1);client._ra_frame();await settle();client._ra_snapshot();
 assert.equal(events.filter(e=>e.kind==='unlock').length,1);
 assert.equal(snapshot.items.find(a=>a.id===5501).unlocked,true);
 for(let i=0;i<500;i++){client._ra_frame();client._ra_idle();}
 assert.deepEqual(requests.map(p=>p.get('r')),['login2','achievementsets']);
 assert.equal(requests[0].has('p'),false);client._ra_unload();client._ra_logout();
});
test('isolated MAME boots real Pac-Man and translates credit/work/video/colour RAM', {skip:!process.env.PACMAN_TEST_ROM},async()=>{
 const m=await load('mame-pacman',{onLog(){}});m.FS.mkdir('/roms');m.FS.mkdir('/saves');
 m.FS.writeFile('/roms/pacman.zip',fs.readFileSync(process.env.PACMAN_TEST_ROM));assert.equal(m._probe_load(),1);
 for(let i=0;i<600;i++)m._probe_step(i>300&&i<310?4:0);
 assert.equal(m._probe_width(),224);assert.equal(m._probe_height(),288);
 assert.equal(m._probe_cpu_byte(0x4e6e),1);assert.equal(m._probe_ra_byte(0x66e),1);
 for(let i=0;i<0x400;i++){
  assert.equal(m._probe_ra_byte(0x400+i),m._probe_cpu_byte(0x4c00+i));
  assert.equal(m._probe_ra_byte(0x1010+i),m._probe_cpu_byte(0x4400+i));
  assert.equal(m._probe_ra_byte(0x1410+i),m._probe_cpu_byte(0x4000+i));
 }
 for(const a of [0,0x3ff,0x800,0xfff,0x1810,0xffffffff])assert.equal(m._probe_ra_byte(a),-1);
 for(let i=0;i<900;i++)m._probe_step(i<10?8:0);
 assert.equal(m._probe_ra_byte(0x66e),0); // Starting consumes the coin through real game code.
});
