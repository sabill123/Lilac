import * as THREE from 'three';
export type HeroMode='profile'|'album'|'concert';
export const HERO_TEXTURE_TIMEOUT_MS=12000,HERO_MAX_LOADS=2,HERO_TEXTURE_MAX_DESKTOP=2048,HERO_TEXTURE_MAX_MOBILE=1024;
export function heroUv(imageAspect:number,viewAspect:number){const x=Math.min(1,viewAspect/imageAspect),y=Math.min(1,imageAspect/viewAspect);return{x,y,offsetX:(1-x)/2,offsetY:(1-y)*.65};}
export function heroPlane(viewAspect:number,imageAspect:number,mode:HeroMode){const h=2*4*Math.tan(35*Math.PI/360),w=h*viewAspect;if(mode==='profile')return{w:w*1.08,h:h*1.08};return imageAspect>viewAspect?{w,h:w/imageAspect}:{w:h*imageAspect,h};}
/** Long edge after the GPU memory cap; never upscales. */
export function heroTextureSize(width:number,height:number,max:number){const long=Math.max(width,height);if(!(long>max)||!(max>0))return{width,height,scaled:false};const s=max/long;return{width:Math.max(1,Math.round(width*s)),height:Math.max(1,Math.round(height*s)),scaled:true};}
type Load={promise:Promise<THREE.Texture>;cancel:()=>void};
export function mountHeroScene(host:HTMLElement,{signal,textureUrl}:{signal:AbortSignal;textureUrl?:(src:string)=>string}){
 let dead=false,visible=false,frame=0,frames=0,started=0,revision=0,burst=0,cooldown=false,coolTimer:ReturnType<typeof setTimeout>|undefined;
 let current:{image:HTMLImageElement;mode:HeroMode;source:string;token:number}|null=null;
 let renderer:THREE.WebGLRenderer|null=null,scene:THREE.Scene|null=null,camera:THREE.PerspectiveCamera|null=null,mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>|null=null;
 // epoch fences every GPU generation: reduced-motion release and destroy bump it, so late loads from an older generation are disposed.
 let bound=0,lost=false,broken=false,failed=0,waiting=0,epoch=0;const cache=new Map<string,THREE.Texture>(),loads=new Map<string,Load>();
 let canvas:HTMLCanvasElement|null=null;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),compact=matchMedia('(max-width: 760px), (pointer: coarse)');const pointer={x:0,y:0,tx:0,ty:0};let width=0,height=0,aspect=1;
 const status=(s:string)=>{if(!dead)host.dataset.heroScene=s;};
 const stop=()=>{if(frame)cancelAnimationFrame(frame);frame=0;};
 const fallback=(reason:string)=>{stop();if(canvas)canvas.hidden=true;status(reason);};
 // Honest idle state: sticky conditions win over transient visibility.
 const settle=()=>status(lost?'context-lost':reduce.matches?'reduced':broken||(current&&failed===current.token)?'fallback':document.hidden?'hidden':!visible?'offscreen':'pending');
 const url=(src:string)=>{if(textureUrl)return textureUrl(src);try{return new URL(src,location.href).origin===location.origin?src:'/api/live/img?u='+encodeURIComponent(src);}catch{return '';}};
 function makeCanvas(){const c=document.createElement('canvas');c.className='cover-webgl';c.setAttribute('aria-hidden','true');c.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';c.hidden=true;
  c.addEventListener('webglcontextlost',e=>{e.preventDefault();if(dead||c!==canvas)return;lost=true;bound=0;fallback('context-lost');},{signal});
  c.addEventListener('webglcontextrestored',()=>{if(dead||c!==canvas||!lost)return;lost=false;cache.forEach(t=>{t.needsUpdate=true;});void show();},{signal});return c;}
 function size(){const r=host.getBoundingClientRect();if(!r.width||!r.height)return;width=r.width;height=r.height;aspect=width/height;if(renderer&&camera){renderer.setSize(width,height,false);camera.aspect=aspect;camera.updateProjectionMatrix();fit();wake();}}
 function fit(){if(!mesh||!current?.image||!mesh.material.map)return;const image=mesh.material.map.image as HTMLImageElement;const ratio=(image.naturalWidth||image.width||1)/(image.naturalHeight||image.height||1),plane=heroPlane(aspect,ratio,current.mode);mesh.scale.set(plane.w,plane.h,1);const uv=current.mode==='profile'?heroUv(ratio,aspect):{x:1,y:1,offsetX:0,offsetY:0};mesh.material.map.repeat.set(uv.x,uv.y);mesh.material.map.offset.set(uv.offsetX,uv.offsetY);mesh.material.map.needsUpdate=true;}
 function init(){if(renderer)return true;if(dead||broken||lost||!visible||document.hidden||reduce.matches)return false;try{canvas=canvas||makeCanvas();renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.setClearColor(0,0);scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(35,aspect,.1,50);camera.position.z=4;const geometry=new THREE.PlaneGeometry(1,1,40,24),material=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide,depthTest:false});mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);size();return true;}catch{renderer?.dispose();renderer=null;broken=true;fallback('fallback');return false;}}
 /** Releases every GPU object and the context itself. The canvas is discarded (never reused after a forced loss); init() makes a fresh one. */
 function release(){epoch++;stop();clearTimeout(coolTimer);cooldown=false;burst=0;bound=0;waiting=0;
  const inflight=[...loads.values()];loads.clear();inflight.forEach(l=>l.cancel());
  cache.forEach(t=>t.dispose());cache.clear();mesh?.geometry.dispose();mesh?.material.dispose();
  if(renderer){renderer.dispose();renderer.forceContextLoss();}renderer=null;scene=null;camera=null;mesh=null;
  canvas?.remove();canvas=null;lost=false;}
 function draw(now:number){frame=0;if(dead||lost||bound!==current?.token||!visible||document.hidden||reduce.matches||!renderer||!camera||!scene||!mesh?.material.map||!current||!canvas)return;pointer.x+=(pointer.tx-pointer.x)*.09;pointer.y+=(pointer.ty-pointer.y)*.09;const energy=Math.max(0,1-(now-started)/950),pos=mesh.geometry.attributes.position as THREE.BufferAttribute;for(let i=0;i<pos.count;i++){const col=i%41,row=Math.floor(i/41),x=col/40-.5,y=.5-row/24;const fold=Math.sin((x+.5)*Math.PI)*Math.sin(y*5+energy*4)*energy;pos.setXYZ(i,x+Math.sin(y*4+energy*3)*energy*.006,y,fold*.14+Math.sin(x*3)*pointer.x*.045);}pos.needsUpdate=true;mesh.rotation.y=pointer.x*.035;mesh.rotation.x=-pointer.y*.022;
  try{renderer.render(scene,camera);frames++;burst++;canvas.dataset.frames=String(frames);canvas.dataset.revision=String(current.token);canvas.hidden=false;host.dataset.heroScene='ready';}catch{broken=true;fallback('fallback');return;}
  const moving=energy>0||Math.abs(pointer.tx-pointer.x)+Math.abs(pointer.ty-pointer.y)>.001;
  if(moving&&burst<240)frame=requestAnimationFrame(draw);else if(burst>=240){cooldown=true;pointer.tx=pointer.ty=0;clearTimeout(coolTimer);coolTimer=setTimeout(()=>{cooldown=false;burst=0;},1200);}
 }
 function wake(){if(dead||lost||bound!==current?.token||frame||cooldown||!visible||document.hidden||reduce.matches||!mesh?.material.map)return;frame=requestAnimationFrame(draw);}
 function trim(){while(cache.size>4){const key=[...cache.keys()].find(k=>k!==current?.source);if(!key)break;cache.get(key)?.dispose();cache.delete(key);}}
 /** Decodes into a private image (the DOM <img> is never touched) and caps the long edge with a 2D canvas before GPU upload. */
 function toTexture(img:HTMLImageElement){const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,cap=Math.min(compact.matches?HERO_TEXTURE_MAX_MOBILE:HERO_TEXTURE_MAX_DESKTOP,renderer?.capabilities?.maxTextureSize||Infinity),dim=heroTextureSize(w,h,cap);let source:HTMLImageElement|HTMLCanvasElement=img;
  if(dim.scaled){try{const c=document.createElement('canvas');c.width=dim.width;c.height=dim.height;const g=c.getContext('2d');if(g){g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(img,0,0,dim.width,dim.height);source=c;img.removeAttribute('src');}}catch{source=img;}}
  const t=new THREE.Texture(source);t.colorSpace=THREE.SRGBColorSpace;t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;}
 function request(source:string){const gen=epoch,img=document.createElement('img');let timer:ReturnType<typeof setTimeout>|undefined,settled=false,cancel=()=>{};
  const promise=new Promise<THREE.Texture>((resolve,reject)=>{
   const done=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);img.onload=img.onerror=null;if(error){img.removeAttribute('src');reject(error);return;}try{resolve(toTexture(img));}catch(e){reject(e);}};
   img.onload=()=>done();img.onerror=()=>done(new Error('image'));cancel=()=>done(new Error('abort'));timer=setTimeout(()=>done(new Error('timeout')),HERO_TEXTURE_TIMEOUT_MS);
   img.crossOrigin='anonymous';img.decoding='async';img.src=url(source);});
  const load:Load={promise,cancel:()=>cancel()};loads.set(source,load);
  promise.then(t=>{if(dead||gen!==epoch){t.dispose();return;}cache.set(source,t);trim();}).catch(()=>{}).finally(()=>{if(loads.get(source)===load)loads.delete(source);kick();});
  return load;}
 /** A slot opened: retry only the newest row that was waiting for one (never a row whose own load failed). */
 function kick(){if(dead||!waiting||!current||current.token!==waiting)return;waiting=0;void show();}
 async function show(){const row=current;if(!row||dead)return;if(lost||broken||reduce.matches||!visible||document.hidden||failed===row.token){settle();return;}
  if(!init())return;const gen=epoch;if(canvas&&!host.contains(canvas))host.append(canvas);let texture=cache.get(row.source);
  if(!texture){let load=loads.get(row.source);if(!load){if(loads.size>=HERO_MAX_LOADS){waiting=row.token;canvas!.hidden=true;status('loading');return;}load=request(row.source);}
   canvas!.hidden=true;status('loading');
   try{texture=await load.promise;}catch{if(!dead&&gen===epoch&&current?.token===row.token&&host.isConnected){failed=row.token;fallback('fallback');}return;}
  }
  if(dead||gen!==epoch||!current||current.token!==row.token||!host.isConnected)return;
  if(lost||reduce.matches||!visible||document.hidden||!renderer||!mesh||!canvas){settle();return;}
  if(!host.contains(canvas))host.append(canvas);canvas.hidden=true;bound=row.token;mesh.material.map=texture;mesh.material.needsUpdate=true;fit();started=performance.now();burst=0;cooldown=false;clearTimeout(coolTimer);stop();status('loading');wake();
 }
 function setImage(image:HTMLImageElement,mode:HeroMode){if(dead||signal.aborted)return;revision++;bound=0;waiting=0;current={image,mode,source:image.currentSrc||image.src,token:revision};if(canvas)canvas.hidden=true;stop();pointer.x=pointer.y=pointer.tx=pointer.ty=0;status(lost?'context-lost':reduce.matches?'reduced':'pending');void show();}
 const away=()=>{stop();if(canvas)canvas.hidden=true;settle();};
 const intersect=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);if(visible)void show();else away();},{rootMargin:'60px'});intersect.observe(host);
 const resize=new ResizeObserver(size);resize.observe(host);
 const move=(e:PointerEvent)=>{if(e.pointerType==='touch'||!visible)return;const r=host.getBoundingClientRect();pointer.tx=Math.max(-1,Math.min(1,(e.clientX-r.left)/r.width*2-1));pointer.ty=Math.max(-1,Math.min(1,(e.clientY-r.top)/r.height*2-1));wake();};
 const leave=()=>{pointer.tx=pointer.ty=0;wake();},visibility=()=>{if(document.hidden)away();else void show();},motion=()=>{if(reduce.matches){release();fallback('reduced');}else void show();};
 host.addEventListener('pointermove',move,{passive:true,signal});host.addEventListener('pointerleave',leave,{signal});document.addEventListener('visibilitychange',visibility,{signal});reduce.addEventListener('change',motion);
 const destroy=()=>{if(dead)return;release();dead=true;intersect.disconnect();resize.disconnect();reduce.removeEventListener('change',motion);delete host.dataset.heroScene;};signal.addEventListener('abort',destroy,{once:true});size();return{setImage,destroy};
}
