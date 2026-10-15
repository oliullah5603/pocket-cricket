/* Perspective stadium and directional characters. Match rules stay in engine.js. */
(() => {
  'use strict';
  const P = window.CricketPitch.prototype;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), mix=(a,b,t)=>a+(b-a)*t;
  const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  const norm=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const world=(x,y,h=0)=>[(x-360)*.13,h,(y-218)*.18];
  P.setPresentationRole=function(role){
    role=role==='bowling'?'bowling':'batting';
    if(this._presentationRole!==role){this._presentationRole=role;this._draw();}
  };
  const originalBowlAim=P._bowlAimFromPointer;
  P._bowlAimFromPointer=function(event){this._bowlingScreenStart=event.clientY;originalBowlAim.call(this,event);};
  P._updateBowlDrag=function(event){this.setBowlingAim({speed:.65+(event.clientY-this._bowlingScreenStart)/110*.35});};
  P._cameraForScene=function(){
    const width=this._view.width,height=this._view.height,root=this.canvas.parentElement;
    const rect=this.canvas.getBoundingClientRect(),header=root?.querySelector('.top-hud')?.getBoundingClientRect(),hud=root?.querySelector('.bottom-hud')?.getBoundingClientRect();
    const top=Math.max(35,header?.bottom-rect.top+8||70),bottom=Math.max(top+100,hud?.top-rect.top-8||height-100),space=bottom-top;
    const bowling=this._presentationRole==='bowling';
    const hit=this._shot && this._elapsed>this._hitAt+120;
    let eye,target,focal;
    if(hit){
      eye=[13,36,bowling?-43:43];target=[0,0,1];focal=Math.min(space*1.22,width*.72);
    }else if(bowling){
      const phase=this.deliveryPhase(this.active?Math.min(this._elapsed,this._releaseAt):0);
      const follow=clamp((phase.position.y-104)/43,0,1);
      eye=world(387,mix(60,103,smooth(follow)),4.7);target=world(360,280,.95);focal=Math.min(space*1.75,width*1.65);
    }else{
      eye=world(width>700?420:394,345,3.8);target=world(360,174,1.1);focal=Math.min(space*1.65,width*1.05);
    }
    const forward=norm(target.map((v,i)=>v-eye[i])),right=norm(cross([0,1,0],forward)),up=cross(forward,right);
    return {width,height,top,bottom,space,bowling,wide:!!hit,eye,forward,right,up,focal,cx:width*(bowling||hit?.5:.42),cy:top+space*.45};
  };
  P._project=function(x,y,h=0){
    const c=this._camera,w=world(x,y,h),v=w.map((n,i)=>n-c.eye[i]),depth=dot(v,c.forward);
    if(depth<1)return null;
    return {x:c.cx+c.focal*dot(v,c.right)/depth,y:c.cy-c.focal*dot(v,c.up)/depth,scale:c.focal/depth,depth};
  };
  P.clientToLogical=function(clientX,clientY){
    const c=this._camera||this._cameraForScene(),r=this.canvas.getBoundingClientRect();
    const sx=(clientX-r.left)*c.width/Math.max(1,r.width),sy=(clientY-r.top)*c.height/Math.max(1,r.height);
    const ray=c.forward.map((v,i)=>v+c.right[i]*(sx-c.cx)/c.focal+c.up[i]*(c.cy-sy)/c.focal);
    const distance=clamp(-c.eye[1]/Math.min(-.015,ray[1]),0,150);
    return {x:360+(c.eye[0]+ray[0]*distance)/.13,y:218+(c.eye[2]+ray[2]*distance)/.18};
  };
  P._screenPoly=function(points,fill,stroke,width=1){
    const c=this.ctx;if(points.some(p=>!p))return;
    c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
  };
  P._groundPoly=function(points,fill,stroke,width){this._screenPoly(points.map(p=>this._project(...p)),fill,stroke,width);};
  P._groundLine=function(a,b,color,width=1){
    const p=this._project(...a),q=this._project(...b);if(!p||!q)return;
    const c=this.ctx;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.strokeStyle=color;c.lineWidth=width;c.stroke();
  };
  P._jointWorld=function(joint,point){
    return {x:joint.position.x+(point.x-joint.position.x)*.055/.13,y:joint.frontFoot.y,h:1.84+(joint.position.y-7*1.02-point.y)*.045};
  };
  P._perspectiveGround=function(){
    const c=this.ctx,v=this._camera,w=v.width,h=v.height;
    const sky=c.createLinearGradient(0,0,0,h*.65);sky.addColorStop(0,'#21144d');sky.addColorStop(.5,'#5662a2');sky.addColorStop(1,'#c1a9c8');c.fillStyle=sky;c.fillRect(0,0,w,h);
    const horizontal=norm([v.forward[0],0,v.forward[2]]);
    const horizon=clamp(v.cy-v.focal*dot(horizontal,v.up)/dot(horizontal,v.forward),v.top+35,v.bottom-45),standTop=Math.max(0,horizon-v.space*.35);
    c.fillStyle='#19264e';c.fillRect(0,standTop,w,horizon-standTop+12);
    for(let row=0;row<7;row++){
      const y=mix(standTop+8,horizon-8,row/6),size=clamp(v.space*.008,2,4.5);
      for(let col=0;col<w/(size*2.8);col++){
        const x=col*size*2.8+(row%2)*size;
        c.fillStyle=['#c6a176','#d2b397','#a57a62'][(col+row)%3];c.beginPath();c.arc(x+size*.5,y,size*.32,0,Math.PI*2);c.fill();
        c.fillStyle=['#556db0','#b5949f','#8eb2bb','#d2ab70','#383e7f'][(col*7+row*3)%5];
        c.fillRect(x,y+size*.4,size,size);
      }
      c.fillStyle='#a5b5e733';c.fillRect(0,y+size*1.7,w,1);
    }
    c.fillStyle='#433a90';c.fillRect(0,horizon-4,w,17);
    c.fillStyle='#c5d8e8';c.font='bold 9px Arial';c.textAlign='center';
    for(let x=70;x<w;x+=180)c.fillText('POCKET CRICKET',x,horizon+8);
    c.fillStyle='#629c2d';c.fillRect(0,horizon+13,w,h-horizon);
    for(let i=0;i<18;i++){
      const y=60+i*20;
      this._groundPoly([[10,y],[710,y],[710,y+20],[10,y+20]],i%2?'#63a332':'#74b63d');
    }
    for(let i=0;i<64;i++){
      const a=i*Math.PI/32,b=(i+1)*Math.PI/32;
      this._groundLine([360+Math.cos(a)*304,218+Math.sin(a)*145],[360+Math.cos(b)*304,218+Math.sin(b)*145],'#e9edcc',2);
    }
    this._groundPoly([[331,158],[389,158],[398,308],[323,308]],'#bba869','#887346',1);
    this._groundPoly([[337,158],[383,158],[389,308],[330,308]],'#d3bf7b');
    for(let i=0;i<80;i++){
      const y=160+i*1.8,x=337+(i*17)%44;
      this._groundLine([x,y],[x+2,y+.6],i%3?'#ad995522':'#fff5bb33',1);
    }
    [[174,336,384],[188,330,390],[280,316,404],[298,320,400]].forEach(([y,a,b])=>this._groundLine([a,y],[b,y],'#fff4d8',2));
    [174,280].forEach(y=>[334,386].forEach(x=>this._groundLine([x,y-6],[x,y+14],'#fff4d8',1.5)));
    [0.08,.92].forEach(f=>{
      const x=w*f,y=standTop+8;
      c.strokeStyle='#a1b0d1';c.lineWidth=3;c.beginPath();c.moveTo(x,horizon);c.lineTo(x,y);c.stroke();
      const glow=c.createRadialGradient(x,y,2,x,y,60);glow.addColorStop(0,'#e5f8ff60');glow.addColorStop(1,'#cde9ff00');c.fillStyle=glow;c.fillRect(x-60,y-60,120,120);
      c.fillStyle='#f2fcff';for(let j=0;j<8;j++)c.fillRect(x-15+(j%4)*9,y-5+Math.floor(j/4)*8,5,4);
    });
  };
  P._stumps3d=function(y){
    const broken=y===298&&this._bowled&&this._elapsed>this._hitAt+200;
    [-4,0,4].forEach((dx,i)=>this._groundLine([360+dx,y,0],[360+dx+(broken?(i-1)*8:0),y+(broken?5:0),broken?.3:1.05],'#f4ca56',3));
    if(!broken)this._groundLine([355,y,1.06],[365,y,1.06],'#ffe089',3);
  };
  P._character3d=function(actor){
    const p=this._project(actor.x,actor.y);if(!p||p.depth>110)return;
    const c=this.ctx,ppm=clamp(p.scale,2,100),bowler=actor.bowler;
    const target=actor.target||{x:360,y:280},fw=norm([(target.x-actor.x)*.13,0,(target.y-actor.y)*.18]);
    const aw=world(actor.x,actor.y),towardCamera=norm([this._camera.eye[0]-aw[0],0,this._camera.eye[2]-aw[2]]);
    const front=dot(fw,towardCamera),side=dot(fw,this._camera.right),back=front<-.9,bodyBack=front<-.15;
    const stride=actor.running?Math.sin(this._elapsed*.014+(bowler?.35:actor.index))*.35:0;
    const bob=actor.running?Math.abs(Math.sin(this._elapsed*.014))*.055:0;
    const shirt=actor.batter?'#f3c849':'#3f78db',shade=actor.batter?'#c88c28':'#244da4',skin=['#d99968','#ab6d47','#ecc19a','#ba845b'][actor.index%4];
    const shadow=[];for(let i=0;i<16;i++){const a=i*Math.PI/8;shadow.push([actor.x+Math.cos(a)*5,actor.y+Math.sin(a)*2]);}this._groundPoly(shadow,'#183b2440');
    c.save();c.translate(p.x,p.y);c.scale(ppm*(bowler?1:clamp(.5+.5*Math.abs(front),.55,1)),ppm);c.lineCap='round';c.lineJoin='round';
    const line=(x,y,x2,y2,color,width)=>{c.beginPath();c.moveTo(x,-y);c.lineTo(x2,-y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();};
    const oval=(x,y,rx,ry,color)=>{c.beginPath();c.ellipse(x,-y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();};
    const leg=(sgn,step)=>{
      const hip=sgn*.19,knee=hip+step*.25,foot=hip-step*.8,lift=Math.max(0,step)*.45;
      line(hip,1.05+bob,knee,.57+lift,shade,.27);line(knee,.57+lift,foot,.08+lift,shirt,.23);
      line(foot-.1,.055+lift,foot+.14,.055+lift,'#f5f4e8',.17);
      if(actor.batter){line(knee,.6+lift,foot,.18+lift,'#f1e6cf',.3);line(knee-.06,.57+lift,foot-.06,.22+lift,'#c2c9c9',.025);}
    };
    leg(-1,stride);leg(1,-stride);
    c.save();c.translate(0,-bob);if(actor.running)c.rotate(side*.07);
    const cloth=c.createLinearGradient(-.4,-2,.4,-1);cloth.addColorStop(0,shirt);cloth.addColorStop(1,shade);
    c.beginPath();c.moveTo(-.37,-1.91);c.quadraticCurveTo(-.45,-1.5,-.27,-1.01);c.lineTo(.27,-1.01);c.quadraticCurveTo(.45,-1.5,.37,-1.91);c.closePath();c.fillStyle=cloth;c.fill();
    line(-.28,1.08,.28,1.08,'#edf0dc',.045);
    if(bodyBack){c.fillStyle='#e5f1ff';c.font='bold .3px Arial';c.textAlign='center';c.fillText(String(actor.index+7),0,-1.46);}else{line(-.17,1.91,0,1.78,'#fff0c5',.055);line(0,1.78,.17,1.91,'#fff0c5',.055);oval(.19,1.64,.065,.065,'#f3e6a0');}
    const arm=(sgn)=>{
      let elbow={x:sgn*.51,y:1.39},hand={x:sgn*.54,y:1.03};
      if(actor.running){elbow.y+=stride*sgn*.7;hand.y+=stride*sgn*1.3;}
      if(actor.catch){elbow={x:sgn*.42,y:2.03};hand={x:sgn*.08,y:2.2};}
      if(actor.batter){elbow={x:side*.34+sgn*.12,y:1.45};hand={x:side*.42,y:1.35};}
      if(bowler&&actor.joints){
        const rawE=sgn>0?actor.joints.rightElbow:actor.joints.leftElbow,rawH=sgn>0?actor.joints.rightHand:actor.joints.leftHand;
        const map=raw=>{const w=this._jointWorld(actor.joints,raw),q=this._project(w.x,w.y,w.h);return{x:(q.x-p.x)/ppm,y:(p.y-q.y)/ppm};};
        elbow=map(rawE);hand=map(rawH);
      }
      line(sgn*.34,1.84,elbow.x,elbow.y,shirt,.22);line(elbow.x,elbow.y,hand.x,hand.y,skin,.16);
      oval(hand.x,hand.y,actor.batter||actor.catch?.12:.09,.11,actor.batter||actor.catch?'#efefe2':skin);
    };
    arm(-1);arm(1);line(0,1.91,0,2.1,skin,.19);
    const headX=clamp(side,-1,1)*.07;
    oval(headX,2.31,.33,.4,back?'#6b3c29':skin);
    if(back){oval(headX-.31,2.28,.06,.11,skin);oval(headX+.31,2.28,.06,.11,skin);}
    else oval(headX-Math.sign(side||1)*.29,2.28,.08,.12,skin);
    c.beginPath();c.moveTo(headX-.33,-2.4);c.quadraticCurveTo(headX-.42,-2.79,headX+.02,-2.76);c.lineTo(headX+.2,-2.87);c.lineTo(headX+.16,-2.72);c.quadraticCurveTo(headX+.39,-2.74,headX+.33,-2.39);c.quadraticCurveTo(headX+.13,-2.6,headX-.33,-2.4);c.fillStyle=['#4a281f','#241d23','#7e4b29','#38231f'][actor.index%4];c.fill();
    if(!back){
      const profile=Math.abs(side)>.55||front<0,eyeX=headX+side*.09;
      const eyes=profile?[eyeX+Math.sign(side)*.1]:[eyeX-.13,eyeX+.13];
      eyes.forEach(x=>{oval(x,2.36,.065,.075,'#fff9e6');oval(x+side*.018,2.35,.03,.045,'#243344');line(x-.06,2.46,x+.055,2.47,'#4b2d26',.04);});
      c.beginPath();c.moveTo(headX+side*.1,-2.32);c.lineTo(headX+side*.21,-2.22);c.lineTo(headX+side*.06,-2.21);c.strokeStyle='#995738';c.lineWidth=.035;c.stroke();
      line(headX-.08+side*.08,2.1,headX+.09+side*.08,2.09,'#6d392e',.035);
    }
    if(actor.batter){
      c.beginPath();c.ellipse(headX,-2.55,.37,.28,0,Math.PI,Math.PI*2);c.lineTo(headX+.37,-2.46);c.lineTo(headX-.37,-2.46);c.closePath();c.fillStyle='#1d5393';c.fill();
      if(!back){line(headX-.32,2.43,headX+.35,2.42,'#8ea8b8',.04);line(headX-.3,2.15,headX+.34,2.15,'#b4c7c9',.025);line(headX-.3,2.42,headX-.3,2.12,'#9bb1bc',.035);line(headX+.34,2.42,headX+.34,2.12,'#9bb1bc',.035);}
      c.save();c.translate(side*.42,-1.35);
      let angle=back?-.8:.75;
      if(this._shot && actor.index===1 && Number.isFinite(this._swingAt)){const sw=clamp((this._elapsed-this._swingAt)/330,0,1);angle+=Math.sin(sw*Math.PI)*2.0;}
      c.rotate(angle);line(0,0,0,.4,'#2e5d77',.075);line(0,.4,0,1.2,'#e8c68a',.18);line(-.045,.5,-.045,1.16,'#fff0c0',.025);c.restore();
    }
    c.restore();c.restore();
  };
  P._ballWorld=function(time=this._elapsed){
    const state=this.ballStateAt(time);if(!state.visibleCount||!state.position)return null;
    const p=state.position;
    if(state.owner==='bowler'){
      const j=this.deliveryPhase(this.active?Math.min(time,this._releaseAt):0);
      return {...this._jointWorld(j,j.rightHand),owner:state.owner};
    }
    if(state.owner==='fielder')return{x:p.x,y:p.y,h:2.2,owner:state.owner};
    const t=clamp((time-this._hitAt)/Math.max(1,this._flightDuration),0,1),strike=this._sceneDelivery?.length<.3?1.65:this._sceneDelivery?.type==='yorker'?.25:.85;
    let h=p.height*.06;
    let x=p.x;
    if(state.owner==='flight'){
      const j=this.deliveryPhase(this._releaseAt),hand=this._jointWorld(j,j.rightHand),progress=clamp(p.p||0,0,1);
      x+=(hand.x-j.rightHand.x)*(1-progress);
      h+=(hand.h-(j.frontFoot.y-j.rightHand.y)*.06)*Math.max(0,1-progress/p.bounce);
      h+=strike*Math.pow(progress,8);
    }
    if(state.owner==='hit-flight')h+=strike*(1-t)+(this._caught?1.48*smooth(t):0);
    if(state.owner==='return')h+=.5;
    return {x,y:p.y,h,owner:state.owner};
  };
  P._perspectiveBall=function(){
    const ball=this._ballWorld();if(!ball)return;const p=this._project(ball.x,ball.y,ball.h);if(!p)return;
    const c=this.ctx,r=clamp(p.scale*.11,3,9),ground=this._project(ball.x,ball.y,0);
    if(ground&&['flight','hit-flight','return'].includes(ball.owner)){
      c.fillStyle='#18392555';c.beginPath();c.ellipse(ground.x,ground.y,r*1.1,r*.35,0,0,Math.PI*2);c.fill();
      const previous=this._ballWorld(this._elapsed-30);if(previous&&previous.owner===ball.owner){const q=this._project(previous.x,previous.y,previous.h);if(q){c.beginPath();c.moveTo(q.x,q.y);c.lineTo(p.x,p.y);c.strokeStyle='#fff6d19c';c.lineWidth=r*.7;c.lineCap='round';c.stroke();}}
    }
    const g=c.createRadialGradient(p.x-r*.4,p.y-r*.4,.1,p.x,p.y,r);g.addColorStop(0,'#ffc4a8');g.addColorStop(.35,'#c8473e');g.addColorStop(1,'#6d202d');c.fillStyle=g;c.beginPath();c.arc(p.x,p.y,r,0,Math.PI*2);c.fill();
    c.strokeStyle='#ffe5b9';c.lineWidth=Math.max(.7,r*.12);c.beginPath();c.ellipse(p.x,p.y,r*.45,r*.83,.5,0,Math.PI*2);c.stroke();
  };
  P._perspectiveAim=function(){
    const c=this.ctx;
    if(this._presentationRole==='bowling'){
      if(!this._bowlingMode||this.active)return;
      const a=this.bowlingAim,x=360+a.line*24,y=208+a.length*65,p=this._project(x,y,.025);
      const corners=[[336,208],[384,208],[384,273],[336,273]];
      this._groundPoly(corners,'#5a3fc31f','#e8d86f77',1);
      const ring=[];for(let i=0;i<36;i++){const t=i*Math.PI/18;ring.push([x+Math.cos(t)*8,y+Math.sin(t)*5,.04]);}this._groundPoly(ring,'#fff39d35','#fff3a5',2);
      this._groundLine([x-13,y,.04],[x+13,y,.04],'#fff8c4',1.5);this._groundLine([x,y-8,.04],[x,y+8,.04],'#fff8c4',1.5);
      if(p){c.font='bold 12px Arial';c.textAlign='center';c.fillStyle='#fff5bd';c.fillText('LAND HERE',p.x,p.y-22);}
      const gx=Math.min(this._camera.width-35,Math.max(28,(p?.x||this._camera.width*.5)+70)),gy=clamp((p?.y||this._camera.top+100)-55,this._camera.top+15,this._camera.bottom-105);
      c.fillStyle='#102a4bcb';c.fillRect(gx,gy,13,90);c.fillStyle='#efcf4d';c.fillRect(gx+3,gy+87*(1-a.speed),7,87*a.speed);c.font='bold 11px Arial';c.fillStyle='#fff2bb';c.textAlign='center';c.fillText(`${Math.round(a.speed*100)}%`,gx+6,gy-7);
      return;
    }
    if(!this.active||!this._interactive||this._shot)return;
    const power=this._effectivePower(),point=window.CricketEngine.boundaryPoint(this._angle,power),p=this._project(point.x,point.y,.1);
    if(!p||p.x<15||p.x>this._camera.width-15||p.y<this._camera.top||p.y>this._camera.bottom)return;
    c.beginPath();c.arc(p.x,p.y,10,0,Math.PI*2);c.strokeStyle='#f7dd65';c.lineWidth=2;c.stroke();
  };
  P._perspectiveResult=function(){
    if(!this._shot)return;
    const when=this._caught?this._catchAt+15:this._hitAt+180;if(this._elapsed<when)return;
    if(this._bowlingMode&&!this.active)return;
    const c=this.ctx,v=this._camera,label=this._result.label;
    c.save();c.font=`900 ${clamp(v.space*.12,24,58)}px Arial`;c.textAlign='center';c.fillStyle=this._result.wicket?'#ff9d87':'#edff89';c.strokeStyle='#17373e';c.lineWidth=4;c.strokeText(label,v.width*.5,v.top+v.space*.2);c.fillText(label,v.width*.5,v.top+v.space*.2);c.restore();
  };
  P._draw=function(){
    if(!this.ctx||!this._view)return;
    this._camera=this._cameraForScene();const c=this.ctx,v=this._view;
    c.setTransform(v.dpr,0,0,v.dpr,0,0);c.clearRect(0,0,v.width,v.height);c.lineCap='round';c.lineJoin='round';
    this._perspectiveGround();this._stumps3d(174);this._stumps3d(298);this._perspectiveAim();
    const hit=this._shot&&this._elapsed>=this._hitAt?clamp((this._elapsed-this._hitAt)/this._flightDuration,0,1):0;
    const actors=this._fielders.map((f,index)=>{
      let x=f.x,y=f.y;
      if(hit>0&&!this._bowled&&index===this._nearestFielder){const reach=this._result.runs>=6?.2:this._result.runs===4?.76:1,t=smooth(hit)*reach;x=mix(x,this._target.x,t);y=mix(y,this._target.y,t);}
      const chase=hit>0&&hit<.9&&index===this._nearestFielder;
      return{x,y,index:index+4,target:chase?this._target:{x:360,y:280},running:chase,catch:this._caught&&index===this._nearestFielder&&hit>.8};
    });
    const joints=this.deliveryPhase(this.active?this._elapsed:this._bowlingMode?0:1500);
    actors.push({x:361,y:joints.frontFoot.y,index:2,bowler:true,joints,running:this.active&&this._elapsed<this._releaseAt*.59,target:{x:360,y:280}});
    const running=hit>0&&hit<1&&this._result.runs>0&&this._result.runs<4&&!this._result.wicket;
    const run=running?.5-Math.cos(hit*Math.PI*Math.min(this._result.runs,3))*.5:0;
    const returning=running&&Math.sin(hit*Math.PI*Math.min(this._result.runs,3))<0;
    actors.push({x:347,y:mix(288,188,run),index:1,batter:true,running,target:{x:361,y:returning?288:174}});
    actors.push({x:running?374:410,y:mix(188,288,run),index:3,batter:true,running,target:{x:360,y:returning?174:280}});
    actors.sort((a,b)=>(this._project(b.x,b.y)?.depth||0)-(this._project(a.x,a.y)?.depth||0));
    actors.forEach(a=>this._character3d(a));this._perspectiveBall();this._perspectiveResult();
  };
})();
