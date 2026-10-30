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
for(const softcore of [false,true]) test(`Pac-Man ${softcore ? 'softcore' : 'spectator'} evaluates RAM with the correct submission policy`,async()=>{
 let client,snapshot;const requests=[],events=[];const ram=new Map([[0x66e,0]]);
 client=await load('rc-client',{
  readMemory(address,length){const b=new Uint8Array(length);for(let i=0;i<length;i++){if(!ram.has(address+i))return null;b[i]=ram.get(address+i);}return b;},
  onSnapshot(value){snapshot=value;},onEvent(event){events.push(event);},
  serverCall(url,body,callback,userdata){const p=new URLSearchParams(body);requests.push(p);let response;
   if(p.get('r')==='login2')response={Success:true,User:'FixtureUser',Token:'fixture-token',Score:0,SoftcoreScore:0};
   else if(p.get('r')==='achievementsets'){
    assert.equal(p.get('m'),'64d1f88b9b276aece4b0edcc25b7a434');
    response={Success:true,GameId:12192,Title:'Offline Pac-Man fixture',ConsoleId:27,ImageIconUrl:'https://example.invalid/icon.png',RichPresenceGameId:12192,RichPresencePatch:'',Sets:[{AchievementSetId:1111,GameId:12192,Title:null,Type:'core',ImageIconUrl:'https://example.invalid/icon.png',Leaderboards:[],Achievements:[['Insert a coin','0xH066e=1'],['Unmapped RAM','0xH0000=1'],['Already earned','0xH066e=2']].map(([Title,MemAddr],i)=>({ID:127619+i,Title,Description:'Offline fixture only',Flags:3,Points:5,MemAddr,Author:'Fixture',BadgeName:'00234',Created:1367266583,Modified:1376929305}))}]};
   }else if(softcore&&p.get('r')==='startsession')response={Success:true,HardcoreUnlocks:[],Unlocks:[{ID:127621,When:1700000000}]};
   else if(softcore&&p.get('r')==='awardachievement')response={Success:true,Score:0,SoftcoreScore:5,AchievementID:127619,AchievementsRemaining:0};
   else if(softcore&&p.get('r')==='ping')response={Success:true};
   else throw new Error('Unexpected RPC action: '+p.get('r'));
   queueMicrotask(()=>{const b=Buffer.from(JSON.stringify(response)),ptr=client._malloc(b.length+1);client.HEAPU8.set(b,ptr);client.HEAPU8[ptr+b.length]=0;client._ra_reply(callback,userdata,200,ptr,b.length);client._free(ptr);});
  }
 });
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 assert.equal(client._ra_pacman_softcore(softcore?1:0),1);
 client.cwrap('ra_login_token',null,['string','string'])('FixtureUser','fixture-token');await settle();
 assert.equal(client._ra_load_pacman(),1);await settle();await settle();
 assert.equal(events.find(e=>e.kind==='game')?.result,0);
 assert.equal(client._ra_pacman_softcore(softcore?0:1),0); // Cannot promote a running preview.
 client._ra_frame();client._ra_snapshot();assert.equal(snapshot.items.find(a=>a.id===127620).state,3);
 ram.set(0x66e,1);client._ra_frame();await settle();client._ra_snapshot();
 assert.equal(events.filter(e=>e.kind==='unlock').length,1);
 assert.equal(snapshot.items.find(a=>a.id===127619).unlocked,true);
 for(let i=0;i<500;i++){client._ra_frame();client._ra_idle();}
 if(softcore){
  assert.deepEqual(requests.map(p=>p.get('r')),['login2','achievementsets','startsession','awardachievement']);
  const session=requests[2],award=requests[3];
  assert.equal(session.get('g'),'12192');assert.equal(session.get('h'),'0');assert.equal(session.get('m'),'64d1f88b9b276aece4b0edcc25b7a434');
  assert.equal(award.get('a'),'127619');assert.equal(award.get('h'),'0');assert.equal(award.get('m'),session.get('m'));
  ram.set(0x66e,2);client._ra_frame();await settle();client._ra_snapshot();
  assert.equal(snapshot.items.find(a=>a.id===127621).unlocked,true);
  assert.equal(requests.filter(p=>p.get('r')==='awardachievement').length,1); // Previously earned unlock is not submitted twice.
  if(process.env.PACMAN_RPC_CONTRACT)fs.writeFileSync(process.env.PACMAN_RPC_CONTRACT,JSON.stringify(requests.map(p=>p.toString())));
 }else assert.deepEqual(requests.map(p=>p.get('r')),['login2','achievementsets']);
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
 const pixels=m.HEAPU32.subarray(m._probe_pixels()/4,m._probe_pixels()/4+224*288);
 let blue=0,white=0;
 for(const pixel of pixels){
  const r=pixel&255,g=(pixel>>>8)&255,b=(pixel>>>16)&255;
  if(b>150&&r<80&&g<80)blue++;
  if(r>180&&g>180&&b>180)white++;
 }
 // A missing default gamma previously made the blue maze and white text black.
 assert.ok(blue>1000,`Expected the blue maze, got ${blue} blue pixels`);
 assert.ok(white>50,`Expected visible score text, got ${white} white pixels`);
});

test('preview gamepad supports D-pad, stick deadzone, coin/start and disconnect',()=>{
 const context=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/features/retroachievements/mamePreviewControls.js'),'utf8').replace('export function','function'),context);
 const buttons=Array.from({length:16},()=>({pressed:false}));
 const pad={connected:true,mapping:'standard',id:'Fixture controller',axes:[0.1,-0.1],buttons};
 const read=()=>context.readPreviewGamepad([null,pad]);
 assert.equal(read().mask,0);assert.equal(read().name,'Fixture controller');
 buttons[8].pressed=true;assert.equal(read().mask,4);buttons[8].pressed=false;
 buttons[9].pressed=true;assert.equal(read().mask,8);buttons[9].pressed=false;
 buttons[1].pressed=true;assert.equal(read().mask,4);buttons[1].pressed=false;
 buttons[0].pressed=true;assert.equal(read().mask,8);buttons[0].pressed=false;
 for(const [button,bit]of[[12,4],[13,5],[14,6],[15,7]]){
  buttons[button].pressed=true;assert.equal(read().mask,1<<bit);buttons[button].pressed=false;
 }
 pad.axes=[-0.8,0.8];assert.equal(read().mask,(1<<6)|(1<<5));
 pad.connected=false;assert.equal(read().mask,0);assert.equal(read().name,'');
 pad.connected=true;pad.mapping='';assert.equal(read().mask,0);
});
