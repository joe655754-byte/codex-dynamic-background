import assert from 'node:assert/strict';
import { createPlaybackController as create } from '../skills/codex-dynamic-background/scripts/runtime/playback-controller.mjs';
let now=0;
class Video extends EventTarget {
  currentTime=0; duration=30; paused=false; readyState=4; networkState=1; _frames=0; dropped=0;
  videoWidth=1920; videoHeight=1080; error=null; playCalls=0; loadCalls=0; pauseCalls=0;
  style={visibility:''}; blockMetadata=false; failLoads=false;
  get frames(){return this._frames}
  set frames(value){this._frames=value;if(this.frameCallback&&!this.blockPresentation)this.frameCallback(now,{presentedFrames:value-this.dropped,mediaTime:this.currentTime})}
  getVideoPlaybackQuality(){return {totalVideoFrames:this.frames,droppedVideoFrames:this.dropped}}
  play(){this.playCalls++;this.paused=false;return Promise.resolve()}
  pause(){this.pauseCalls++;this.paused=true}
  load(){
   this.loadCalls++;this.currentTime=0;this.frames=0;this.readyState=1;
   if(this.failLoads)queueMicrotask(()=>{this.error=new Error('Decoder unavailable');this.dispatchEvent(new Event('error'))});
   else if(!this.blockMetadata)queueMicrotask(()=>{this.readyState=2;this.dispatchEvent(new Event('loadeddata'))});
  }
  requestVideoFrameCallback(callback){this.frameCallback=callback;return 1}
  cancelVideoFrameCallback(){this.cancelled=true}
}
function fixture({fallback=false,poster=false}={}){
 now=0;const v=new Video();if(fallback)v.requestVideoFrameCallback=undefined;
 const d=new EventTarget();d.hidden=false;d.visibilityState='visible';
 d.createElement=()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,cached-frame'});
 const w=new EventTarget();const image=poster?{src:'',style:{visibility:'hidden'}}:null;
 return {v,d,w,image,c:create(v,d,w,{now:()=>now},image)};
}
const passed=[];
{
 const {v,c}=fixture();v.blockPresentation=true;
 now=1500;v.currentTime=1.5;v.frames=90;assert.equal((await c.check()).advancing,false);
 now=6000;v.currentTime=6;v.frames=360;const health=await c.check();assert.equal(health.state,'recovering');assert.equal(health.recoveries,1);assert.equal(health.presentedFrames,0);
 c.dispose();passed.push('moving clock and decoder without presented callbacks never reports active');
}
{
 const {v,c}=fixture({fallback:true});
 now=1500;v.currentTime=1.5;v.dropped=90;v.frames=90;assert.equal((await c.check()).advancing,false);
 now=6000;v.currentTime=6;v.dropped=360;v.frames=360;const health=await c.check();assert.equal(health.state,'recovering');assert.equal(health.presentedFrames,0);assert.equal(health.presentationMode,'total-minus-dropped');
 c.dispose();passed.push('all-dropped decoder frames trigger recovery when frame callbacks are unavailable');
}
{
 const {v,c}=fixture({fallback:true});now=1500;v.currentTime=1.5;v.dropped=5;v.frames=90;
 const health=await c.check();assert.equal(health.state,'active');assert.equal(health.presentedFrames,85);c.dispose();passed.push('fallback counts only frames not dropped');
}
{
 const {v,c}=fixture();v.frameCallback(1,{presentedFrames:1,mediaTime:29.8});v.frameCallback(2,{presentedFrames:2,mediaTime:.1});
 v.frameCallback(3,{presentedFrames:3,mediaTime:.2});assert.equal(c.diagnostics().loopCount,1);assert.equal(c.diagnostics().presentedFrames,3);
 c.dispose();passed.push('presented-frame loop counter for short videos');
}
{
 const {v,c}=fixture();now=1500;v.currentTime=29.9;v.frames=60;assert.equal((await c.check()).state,'active');
 now=3000;v.currentTime=.2;v.frames=78;assert.equal((await c.check()).state,'active');c.dispose();passed.push('normal playback and loop rollover');
}
{
 const {v,c}=fixture();now=6000;let h=await c.check();assert.equal(h.lastRecovery,'seek-and-resume');assert.equal(h.recoveries,1);assert.equal(v.currentTime,.15);
 assert.equal(v.pauseCalls,0,'soft seek must preserve the visible frame');
 now=12000;h=await c.check();assert.equal(h.lastRecovery,'reload-and-resume');assert.equal(v.loadCalls,1);
 now=13500;v.currentTime+=1.5;v.frames+=90;h=await c.check();assert.equal(h.state,'active');assert.equal(h.reloads,1);c.dispose();passed.push('false-playing stall, failed seek escalation, resumed progress');
}
{
 const {v,c}=fixture();v.paused=true;v.play=()=>{v.playCalls++;return Promise.reject(new Error('temporary play rejection'))};
 now=6000;let h=await c.check();assert.equal(h.lastRecovery,'resume-only');assert.equal(h.recoveries,0);assert.equal(h.reloads,0);assert.equal(v.pauseCalls,0);
 now=8000;await c.check();assert.equal(v.playCalls,1,'resume retries are spaced out');
 v.play=()=>{v.playCalls++;v.paused=false;return Promise.resolve()};
 now=11000;h=await c.check();assert.equal(v.paused,false);assert.equal(h.reloads,0);assert.equal(v.loadCalls,0);
 c.dispose();passed.push('temporary paused video resumes without clearing its frame or hard loading');
}
{
 const {v,c}=fixture();let current=0;
 Object.defineProperty(v,'currentTime',{get:()=>current,set:()=>{throw new Error('seek temporarily blocked')}});
 now=6000;let h=await c.check();assert.equal(h.lastRecovery,'seek-and-resume');assert.equal(v.loadCalls,0);
 now=12000;h=await c.check();assert.equal(h.lastRecovery,'seek-and-resume');assert.equal(v.loadCalls,0);
 c.dispose();passed.push('failed soft seek does not escalate to a black-frame reload');
}
{
 const {v,c,d}=fixture();d.hidden=true;d.visibilityState='hidden';d.dispatchEvent(new Event('visibilitychange'));
 now=30000;let h=await c.check();assert.equal(h.state,'suspended');assert.equal(h.recoveries,0);assert.equal(v.paused,true);
 d.hidden=false;d.visibilityState='visible';d.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();
 now=31500;v.currentTime+=1.5;v.frames+=90;h=await c.check();assert.equal(h.state,'active');c.dispose();passed.push('hidden suspension and visible resume');
}
{
 const {v,c}=fixture();for(const time of [6000,12000,18000,24000]){now=time;await c.check()}
 let h=c.diagnostics();assert.equal(h.recoveries,3);assert.equal(v.loadCalls,2);
 assert.equal(h.retryAfterMs,6000,'the third destructive attempt waits for bounded backoff');
 now=30000;await c.check();h=c.diagnostics();assert.equal(v.loadCalls,3);assert.ok(h.retryAfterMs<=20000);
 c.dispose();passed.push('destructive recovery retries with bounded backoff instead of a permanent cap');
}
{
 const {v,c,d,image}=fixture({poster:true});v.blockMetadata=true;
 let captures=0;const makeCanvas=d.createElement;
 d.createElement=(...args)=>{captures++;return makeCanvas(...args)};
 assert.equal(c.capturePoster(),true);assert.match(image.src,/^data:image\/jpeg/);
 now=6000;await c.check();now=12000;const pending=c.check();
 assert.equal(captures,1,'hard reload reuses the decoded poster instead of replacing its src');
 assert.equal(v.loadCalls,1);assert.equal(v.readyState,1);
 assert.equal(image.style.visibility,'visible');assert.equal(v.style.visibility,'hidden');
 const priorPlayCalls=v.playCalls;
 v.dispatchEvent(new Event('loadedmetadata'));await Promise.resolve();
 assert.equal(v.playCalls,priorPlayCalls,'metadata alone is not a displayable frame');
 v.readyState=2;v.dispatchEvent(new Event('loadeddata'));await pending;
 assert.equal(v.paused,false);assert.equal(image.style.visibility,'hidden');assert.equal(v.style.visibility,'');
 c.dispose();passed.push('hard reload keeps a frozen frame until loadeddata');
}
{
 const {v,c,image}=fixture({poster:true});v.blockMetadata=true;
 let current=0;
 Object.defineProperty(v,'currentTime',{get:()=>current,set:value=>{
   current=value;
   if(v.loadCalls&&value>0){v.readyState=1;v.seeking=true;}
 }});
 now=6000;await c.check();now=12000;const pending=c.check();
 v.readyState=2;v.dispatchEvent(new Event('loadeddata'));
 for(let i=0;i<10&&v.readyState!==1;i++)await Promise.resolve();
 assert.equal(v.readyState,1,'seeking invalidated the decoded frame');
 assert.equal(v.paused,true);assert.equal(image.style.visibility,'visible');
 v.seeking=false;v.readyState=2;v.dispatchEvent(new Event('seeked'));await pending;
 assert.equal(v.paused,false);assert.equal(image.style.visibility,'hidden');
 c.dispose();passed.push('hard reload also waits for a decoded frame after seeking');
}
{
 const {v,c,image}=fixture({poster:true});v.error=new Error('Decoder unavailable');v.failLoads=true;
 for(const time of [6000,12000,24000,44000]){now=time;await c.check()}
 const h=c.diagnostics();assert.equal(v.loadCalls,4);assert.equal(image.style.visibility,'visible');
 assert.equal(v.style.visibility,'hidden');assert.ok(h.retryAfterMs<=20000);
 c.dispose();assert.equal(v.style.visibility,'');
 passed.push('repeated failed reloads retain the frozen frame and keep retrying');
}
{
 const {v,c}=fixture();v.readyState=0;v.blockMetadata=true;now=6000;
 const pending=c.check();c.dispose();await pending;assert.equal(v.playCalls,0);assert.equal(v.cancelled,true);assert.equal((await c.check()).state,'stopped');passed.push('cleanup cancels pending reload and prevents late replay');
}
{
 const {v,c}=fixture();now=6000;await c.check();now=7500;v.currentTime+=.016;v.frames++;await c.check();
 now=13500;const h=await c.check();assert.equal(h.lastRecovery,'reload-and-resume');assert.equal(v.loadCalls,1);c.dispose();passed.push('seek-only single frame still escalates to reload');
}
{
 const {v,c,w}=fixture();v.play=()=>Promise.reject(new Error('blocked for test'));
 w.dispatchEvent(new Event('focus'));w.dispatchEvent(new Event('focus'));
 await new Promise(resolve=>setTimeout(resolve,10));now=1000;const h=await c.check();assert.equal(h.lastError,'blocked for test');c.dispose();passed.push('concurrent rejected play calls are handled');
}
console.log(JSON.stringify({passed},null,2));
