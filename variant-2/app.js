const cms=JSON.parse(document.querySelector('#cms-state')?.textContent||'{}');
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
const menu=$('#mobile-menu'),toggle=$('.menu-toggle');toggle.addEventListener('click',()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));toggle.setAttribute('aria-label',menu.hidden?'Открыть меню':'Закрыть меню');toggle.textContent=menu.hidden?'☰':'×'});$$('#mobile-menu a').forEach(a=>a.addEventListener('click',()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.textContent='☰'}));
const promotion=$('#promotion');let dismissed=false;try{dismissed=!!sessionStorage.getItem('vesnushki-garden-promo-'+cms.version)}catch{}function dismissPromo(){promotion.close();try{sessionStorage.setItem('vesnushki-garden-promo-'+cms.version,'1')}catch{}}promotion.querySelector('.close').onclick=dismissPromo;promotion.addEventListener('cancel',dismissPromo);$$('.promo-link').forEach(a=>a.addEventListener('click',dismissPromo));setTimeout(()=>{if(!dismissed&&cms.active&&!$('dialog[open]')&&!$('#contact-form')?.contains(document.activeElement))promotion.showModal()},7000);
$$('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){d===promotion?dismissPromo():d.close()}}});if(d!==promotion)d.querySelector('.close').onclick=()=>d.close()});
const photos=$$('.gallery-item img'),lightbox=$('#lightbox');let index=0;function showPhoto(n){index=(n+photos.length)%photos.length;lightbox.querySelector('img').src=photos[index].src;lightbox.querySelector('img').alt=photos[index].alt;$('#photo-count').textContent=`${index+1} / ${photos.length}`}$$('.gallery-item').forEach((b,i)=>b.onclick=()=>{showPhoto(i);lightbox.showModal()});lightbox.querySelector('.prev').onclick=()=>showPhoto(index-1);lightbox.querySelector('.next').onclick=()=>showPhoto(index+1);lightbox.addEventListener('keydown',e=>{if(e.key==='ArrowRight')showPhoto(index+1);if(e.key==='ArrowLeft')showPhoto(index-1)});let touchX=0;lightbox.addEventListener('touchstart',e=>touchX=e.changedTouches[0].clientX,{passive:true});lightbox.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>45)showPhoto(index+(dx<0?1:-1))},{passive:true});
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('seen');observer.unobserve(e.target)}}),{threshold:.07});$$('.section-top,.advantages article,.group,.activity-layout,.daily,.teachers,.price,.gallery-item').forEach(el=>{el.classList.add('reveal');observer.observe(el)});
const mobileCTA=$('.mobile-cta');if(mobileCTA){if($('.hero'))new IntersectionObserver(([e])=>mobileCTA.classList.toggle('visible',!e.isIntersecting)).observe($('.hero'));else mobileCTA.classList.add('visible');if($('#booking'))new IntersectionObserver(([e])=>mobileCTA.classList.toggle('hide',e.isIntersecting),{threshold:.1}).observe($('#booking'))}
const legal=$('#legal');$$('[data-legal]').forEach(b=>b.onclick=()=>{const consent=b.dataset.legal==='consent';$('#legal-title').textContent=consent?'Обработка персональных данных':'Политика конфиденциальности';const copy=$('#legal-copy');copy.replaceChildren();for(const text of (cms.legal?.[consent?'consent':'privacy']||'').split('\n\n')){const p=document.createElement('p');p.textContent=text;copy.append(p)}legal.showModal()});
const rightsNotice=$('#rights-notice');$('.rights-open').forEach(button=>button.addEventListener('click',()=>rightsNotice.showModal()));
async function recordVisit(){if(!cms.token)return;let session={id:crypto.randomUUID(),last:Date.now()};try{const stored=JSON.parse(sessionStorage.getItem('vesnushki-garden-visit')||'null');if(stored?.id&&Date.now()-stored.last<1800000)session.id=stored.id;sessionStorage.setItem('vesnushki-garden-visit',JSON.stringify(session))}catch{}try{await fetch('/api/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:cms.token,session:session.id,referrer:document.referrer}),keepalive:true})}catch{}}
const teacherCarousel=$('[data-teacher-carousel]');
if(teacherCarousel){
  const slides=[...teacherCarousel.querySelectorAll('.teacher-slide')];
  const empty=teacherCarousel.querySelector('.teacher-carousel-empty');
  const controls=teacherCarousel.querySelector('.teacher-carousel-controls');
  const dots=teacherCarousel.querySelector('.teacher-carousel-dots');
  if(slides.length){
    if(empty)empty.hidden=true;
    let active=0;
    const showSlide=n=>{
      active=(n+slides.length)%slides.length;
      slides.forEach((slide,i)=>{
        slide.classList.toggle('is-active',i===active);
        slide.setAttribute('aria-hidden',String(i!==active));
      });
      dots.querySelectorAll('button').forEach((dot,i)=>dot.setAttribute('aria-current',String(i===active)));
    };
    slides.forEach((slide,i)=>{
      slide.setAttribute('role','group');
      slide.setAttribute('aria-label',`Фото ${i+1} из ${slides.length}`);
      if(i===0)slide.classList.add('is-active');
      else slide.setAttribute('aria-hidden','true');
    });
    if(slides.length>1){
      controls.hidden=false;
      slides.forEach((_,i)=>{
        const dot=document.createElement('button');
        dot.type='button';
        dot.setAttribute('aria-label',`Показать фото ${i+1}`);
        dot.setAttribute('aria-current',String(i===0));
        dot.onclick=()=>showSlide(i);
        dots.append(dot);
      });
      teacherCarousel.querySelector('.teacher-carousel-prev').onclick=()=>showSlide(active-1);
      teacherCarousel.querySelector('.teacher-carousel-next').onclick=()=>showSlide(active+1);
    }else controls.hidden=true;
  }
}
recordVisit();

const promoBooking=$('#promo-booking');
document.querySelectorAll('.booking-open').forEach(button=>button.addEventListener('click',()=>{
  if(promotion.open)dismissPromo();
  promoBooking.showModal();
}));
