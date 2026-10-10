import assert from 'node:assert/strict';
import { createPlaybackController as create } from '../skills/codex-dynamic-background/scripts/runtime/playback-controller.mjs';
let now=0;
class Video extends EventTarget {
  currentTime=0; duration=30; paused=false; readyState=4; networkState=1; _frames=0; dropped=0;
  videoWidth=1920; videoHeight=1080; error=null; playCalls=0; loadCalls=0;
  get frames(){return this._frames}
  set frames(value){this._frames=value;if(this.frameCallback&&!this.blockPresentation)this.frameCallback(now,{presentedFrames:value-this.dropped,mediaTime:this.currentTime})}
  getVideoPlaybackQuality(){return {totalVideoFrames:this.frames,droppedVideoFrames:this.dropped}}
  play(){this.playCalls++;this.paused=false;return Promise.resolve()}
  pause(){this.paused=true}
  load(){this.loadCalls++;this.currentTime=0;this.frames=0;this.readyState=this.blockMetadata?0:1}
  requestVideoFrameCallback(callback){this.frameCallback=callback;return 1}
  cancelVideoFrameCallback(){this.cancelled=true}
}
function fixture({fallback=false}={}){now=0;const v=new Video();if(fallback)v.requestVideoFrameCallback=undefined;const d=new EventTarget();d.hidden=false;d.visibilityState='visible';const w=new EventTarget();return {v,d,w,c:create(v,d,w,{now:()=>now})}}
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
 now=12000;h=await c.check();assert.equal(h.lastRecovery,'reload-and-resume');assert.equal(v.loadCalls,1);
 now=13500;v.currentTime+=1.5;v.frames+=90;h=await c.check();assert.equal(h.state,'active');assert.equal(h.reloads,1);c.dispose();passed.push('false-playing stall, failed seek escalation, resumed progress');
}
{
 const {v,c,d}=fixture();d.hidden=true;d.visibilityState='hidden';d.dispatchEvent(new Event('visibilitychange'));
 now=30000;let h=await c.check();assert.equal(h.state,'suspended');assert.equal(h.recoveries,0);assert.equal(v.paused,true);
 d.hidden=false;d.visibilityState='visible';d.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();
 now=31500;v.currentTime+=1.5;v.frames+=90;h=await c.check();assert.equal(h.state,'active');c.dispose();passed.push('hidden suspension and visible resume');
}
{
 const {v,c}=fixture();for(let i=1;i<=4;i++){now=i*6000;await c.check()}
 const h=c.diagnostics();assert.equal(h.state,'stalled');assert.equal(h.recoveries,3);assert.equal(v.loadCalls,2);c.dispose();passed.push('recovery rate limit');
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
