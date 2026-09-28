export type Signature=number[][][];
export function signatureJSON(value:unknown):string{
 const invalid=()=>{throw Object.assign(Error('Draw your signature in the signature box.'),{status:400})};
 if(!Array.isArray(value)||!value.length||value.length>100)return invalid();
 let count=0,distance=0;
 for(const stroke of value){
  if(!Array.isArray(stroke)||!stroke.length)return invalid();
  count+=stroke.length;if(count>2000)return invalid();
  for(let i=0;i<stroke.length;i++){const p=stroke[i];if(!Array.isArray(p)||p.length!==2||!p.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n))||p[0]<0||p[0]>600||p[1]<0||p[1]>200)return invalid();if(i)distance+=Math.hypot(p[0]-stroke[i-1][0],p[1]-stroke[i-1][1]);}
 }
 if(distance<10)return invalid();
 return JSON.stringify(value);
}
export function signatureSVG(saved:string|null|undefined){
 if(!saved)return '<p>Signature recorded by typed name.</p>';
 try{const strokes=JSON.parse(signatureJSON(JSON.parse(saved))) as Signature;return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" role="img" aria-label="Handwritten signature" style="display:block;width:100%;max-width:600px;border:1px solid #ccc;background:white"><g fill="none" stroke="#183e28" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'+strokes.map(s=>'<polyline points="'+s.map(p=>p.join(',')).join(' ')+'"/>').join('')+'</g></svg>';}catch{return '<p>Signature image unavailable.</p>';}
}
