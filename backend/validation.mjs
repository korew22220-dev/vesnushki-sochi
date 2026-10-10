import fields from '../admin/fields.json' with {type:'json'};
import editor from '../admin/editor.json' with {type:'json'};
export {fields,editor};
const fail=message=>{throw new Error(message)};
export function validate(c){
 if(!c||c.schemaVersion!==2)fail('Неизвестная версия данных сайта');
 const out={schemaVersion:2,texts:{},photos:{},promotion:{},prices:{},contacts:{},blocks:{},extras:{},gallery:[],teachers:[],attributes:{},links:{},legal:{}};
 const str=(v,max)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail('Проверьте длину и формат текста');return v};
 const local=v=>/^\/(?:[a-zA-Z0-9_.-]+|media\/[a-f0-9-]{36}\.(?:jpe?g|png|webp))$/.test(v);
 const safeURL=v=>{const value=str(v,1500).trim();if(/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)||local(value))return value;let u;try{u=new URL(value)}catch{fail('Укажите https-ссылку или якорь раздела')};if(u.protocol!=='https:'||u.username||u.password)fail('Недопустимая ссылка');return value};
 for(const f of fields)out.texts[f.key]=str(c.texts?.[f.key],f.max);
 const photo=(p,withID=true)=>{const url=str(p?.url,300);if(!local(url)||! /\.(?:jpe?g|png|webp|svg)$/i.test(url))fail('Недопустимый адрес фотографии');return {...(withID?{id:str(p.id,80)}:{}),url,alt:str(p.alt,200)}};
 for(const f of editor.photos)out.photos[f.key]=photo(c.photos?.[f.key],false);
 const money=v=>{if(!Number.isInteger(v)||v<0||v>1000000)fail('Цена должна быть целым числом от 0 до 1 000 000');return v};
 for(const key of ['full','half','visit','hour'])out.prices[key]=money(c.prices?.[key]);
 const p=c.promotion;
 if(typeof p?.enabled!=='boolean'||typeof p.popupEnabled!=='boolean')fail('Проверьте настройки акции');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.endDate)||!Number.isFinite(Date.parse(p.endDate))||new Date(p.endDate).toISOString().slice(0,10)!==p.endDate)fail('Укажите существующую дату окончания акции');
 out.promotion={enabled:p.enabled,popupEnabled:p.popupEnabled,title:str(p.title,100),description:str(p.description,300),price:money(p.price),endDate:p.endDate};
 for(const key of ['phone','address','hours','days'])out.contacts[key]=str(c.contacts?.[key],200);
 const digits=out.contacts.phone.replace(/\D/g,'');
 if(digits.length!==11||!['7','8'].includes(digits[0]))fail('Укажите российский номер из 11 цифр');
 if(!/^\d{2}:\d{2}[–-]\d{2}:\d{2}$/.test(out.contacts.hours)||out.contacts.hours.split(/[–-]/).some(x=>Number(x.slice(0,2))>23||Number(x.slice(3))>59))fail('Часы работы: 07:30–19:00');
 for(const key of ['mapUrl','routeUrl']){let u;try{u=new URL(c.contacts?.[key])}catch{fail('Проверьте ссылку на карту')};const hosts=key==='mapUrl'?['2gis.ru']:['2gis.ru','yandex.ru','yandex.com','maps.google.com'];if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.username||u.password||(key==='mapUrl'&&!/\/(?:geo|firm)\/\d+/.test(u.pathname)))fail('Укажите карточку 2ГИС или ссылку маршрута');out.contacts[key]=str(c.contacts[key],1500)}
 const list=(values,limit)=>{if(!Array.isArray(values)||values.length>limit)fail('Превышен лимит фотографий');const result=values.map(p=>photo(p));if(new Set(result.map(p=>p.id)).size!==result.length)fail('Повторяются карточки фотографий');return result};
 out.gallery=list(c.gallery,100);
 for(const block of editor.blocks){if(typeof c.blocks?.[block.key]!=='boolean')fail('Проверьте видимость разделов');out.blocks[block.key]=c.blocks[block.key];out.extras[block.key]=list(c.extras?.[block.key],30)}
 out.teachers=list(c.teachers,30).map((p,i)=>({...p,name:str(c.teachers[i].name,160),role:str(c.teachers[i].role,200)}));
 for(const f of editor.links)out.links[f.key]=safeURL(c.links?.[f.key] ?? (f.key==='link35'?'#main':undefined));
 for(const f of editor.attributes)out.attributes[f.key]=f.kind==='text'?str(c.attributes?.[f.key],f.max):safeURL(c.attributes?.[f.key]);
 for(const key of ['privacy','consent'])out.legal[key]=str(c.legal?.[key],12000);
 return out;
}
export function imagePaths(content){return [...Object.values(content.photos),...content.gallery,...content.teachers,...Object.values(content.extras).flat()].map(p=>p.url)}
export function imageType(bytes){
 if(bytes.length<16)fail('Повреждённое изображение');
 const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return {mime:'image/jpeg',ext:'jpg'};
 if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'&&ascii(12,16)==='IHDR'&&bytes.length>=33&&new DataView(bytes.buffer,bytes.byteOffset).getUint32(16)>0&&new DataView(bytes.buffer,bytes.byteOffset).getUint32(20)>0)return {mime:'image/png',ext:'png'};
 if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(ascii(12,16))&&bytes.length>=24&&new DataView(bytes.buffer,bytes.byteOffset).getUint32(4,true)+8===bytes.length&&new DataView(bytes.buffer,bytes.byteOffset).getUint32(16,true)<=bytes.length-20)return {mime:'image/webp',ext:'webp'};
 fail('Поддерживаются JPG, PNG и WebP');
}
