"""Build GitHub Pages using the original Sites editor schema in content/site.json."""
import argparse
import html
import json
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from cms_html import Document, opening

ROOT = Path(__file__).resolve().parent
MOSCOW = timezone(timedelta(hours=3))

def escape(value):
    return html.escape(str(value), quote=True)

def money(value):
    return f'{value:,}'.replace(',', '\u00a0') + ' ₽'

def render(content, template=None, now=None):
    if content.get('schemaVersion') != 2:
        raise ValueError('Expected site.json schemaVersion 2')
    source = template or (ROOT / 'site-template.html').read_text(encoding='utf-8')
    doc = Document(source)
    changes = []
    attributes = {}
    def inner(node, value):
        changes.append((node.open_end, node.close_start, value))
    def attrs(node, values):
        attributes.setdefault(node.start, (node, {}))[1].update(values)
    promo, contact = content['promotion'], content['contacts']
    end = datetime.fromisoformat(promo['endDate']).replace(hour=23, minute=59, second=59, tzinfo=MOSCOW)
    active = content['blocks']['prices'] and promo['enabled'] and (now or datetime.now(MOSCOW)) <= end
    discount = '−' + str(max(0, round((1-promo['price']/content['prices']['full'])*100))) + '%' if content['prices']['full'] else '0%'
    end_label = datetime.fromisoformat(promo['endDate']).strftime('%d.%m.%Y')
    # Fail builds when editor fields no longer correspond to actual template markers.
    marked = {n.attrs['data-cms-text'] for n in doc.nodes if 'data-cms-text' in n.attrs}
    for key in content['texts']:
        if key not in marked and key not in {'meta.title', 'meta.description'}:
            raise ValueError('Missing text marker: ' + key)
    for key in content['photos']:
        if not any(n.attrs.get('data-cms-photo') == key for n in doc.nodes):
            raise ValueError('Missing photo marker: ' + key)
    for node in doc.nodes:
        a = node.attrs
        key = a.get('data-cms-text')
        if key in content['texts']:
            value = content['texts'][key]
            inner(node, ''.join('<span>'+escape(letter)+'</span>' for letter in value) if key in {'header.copy1','footer.copy1'} else escape(value).replace('\n','<br>'))
        key = a.get('data-cms-photo')
        if key in content['photos']:
            photo = content['photos'][key]
            attrs(node, {'src': photo['url'], 'alt': photo['alt']})
        block = a.get('data-cms-block')
        if block in content['blocks']:
            if not content['blocks'][block]:
                changes.append((node.start, node.end, ''))
            elif content['extras'][block]:
                photos = '<div class="cms-extra-photos wrap">' + ''.join('<figure><img src="'+escape(p['url'])+'" alt="'+escape(p['alt'])+'" loading="lazy"><figcaption>'+escape(p['alt'])+'</figcaption></figure>' for p in content['extras'][block]) + '</div>'
                changes.append((node.close_start, node.close_start, photos))
        key = a.get('data-cms-link')
        if key in content['links']:
            value = content['links'][key]
            if value.startswith('#') and content['blocks'].get(value[1:]) is False:
                changes.append((node.start, node.end, ''))
            else:
                values = {'href':value}
                if value.startswith('https://'):
                    values.update({'target':'_blank','rel':'noopener'})
                attrs(node, values)
        key = a.get('data-cms-attribute')
        if key in content['attributes']:
            field = next(x for x in json.loads((ROOT/'admin/editor.json').read_text())['attributes'] if x['key']==key)
            attrs(node, {field['attribute']:content['attributes'][key]})
        key = a.get('data-cms-video')
        if key:
            attrs(node, {name:content['attributes'][key+'.'+name] for name in ['src','poster']})
        if node.tag == 'title':
            inner(node, escape(content['texts']['meta.title']))
        if node.tag=='meta':
            if a.get('name')=='description' or a.get('property')=='og:description':attrs(node, {'content':content['texts']['meta.description']})
            if a.get('property')=='og:title':attrs(node, {'content':content['texts']['meta.title']})
        if 'data-contact' in a:
            inner(node, escape(contact[a['data-contact']]))
        if node.tag=='a' and (a.get('href') or '').startswith('tel:'):
            digits = re.sub(r'\D', '', contact['phone'])
            attrs(node, {'href':'tel:+7'+digits[1:]})
        if node.has_class('promo-booking-phone'):
            inner(node, 'Или позвонить: '+escape(contact['phone']))
        if 'data-price' in a:
            key = a['data-price']
            value = promo['price'] if key=='full' and active else content['prices']['full'] if key=='fullNormal' else content['prices'][key]
            inner(node, escape(money(value)))
        if 'data-promo-only' in a and not active:
            attrs(node, {'hidden':'hidden'})
        if 'data-promo' in a:
            key = a['data-promo']
            values = {'title':promo['title'],'description':promo['description'],'endLabel':'Акция действует до '+end_label,'discount':discount,'popupEnd':'Полный день · Акция до '+end_label}
            if key!='title' or promo['title']!='Нам 10 лет!':inner(node, escape(values[key]))
        if 'data-promo-badge' in a:
            inner(node, escape(promo['title'] if active else 'ПОЛНЫЙ ДЕНЬ'))
        if node.has_class('anniversary-link'):
            attrs(node, {'aria-label':promo['title']+'. '+promo['description']})
            # Keep original artwork until its embedded offer no longer matches.
            original = promo['title']=='Нам 10 лет!' and promo['description']=='Акция «Нам 10 лет» — скидка 10% на месячный абонемент полного дня' and promo['price']==27900 and content['prices']['full']==31000 and promo['endDate']=='2026-11-30'
            if not original:
                attrs(node, {'class':'anniversary-link cms-promo-live','aria-label':promo['title']+'. '+promo['description']})
                inner(node, '<div><strong>'+escape(promo['title'])+'</strong><p>'+escape(promo['description'])+'</p></div><span class="cms-promo-price">'+escape(money(promo['price']))+'</span>')
            if not active:attrs(node, {'hidden':'hidden'})
        if node.has_class('teacher-carousel-viewport'):
            inner(node, ''.join('<figure class="teacher-slide'+(' is-active' if i==0 else '')+'" data-teacher-id="'+escape(p['id'])+'"><img src="'+escape(p['url'])+'" alt="'+escape(p['alt'])+'" width="866" height="1300" loading="lazy"><figcaption><span class="teacher-role">'+escape(p['role'])+'</span><strong>'+escape(p['name'])+'</strong></figcaption></figure>' for i,p in enumerate(content['teachers'])))
        if node.has_class('gallery'):
            inner(node, ''.join('<button class="gallery-item" aria-label="Открыть фото '+str(i+1)+'"><img src="'+escape(p['url'])+'" alt="'+escape(p['alt'])+'" loading="lazy" width="800" height="1200"></button>' for i,p in enumerate(content['gallery'])))
        if node.has_class('contact-map'):
            org = re.search(r'/(?:geo|firm)/(\d+)',contact['mapUrl']).group(1)
            body=source[node.open_end:node.close_start]
            body=re.sub(r'"id":"\d+"', '"id":"'+org+'"',body)
            body=re.sub(r'href="https://2gis.ru/[^\"]+"','href="'+escape(contact['mapUrl'])+'"',body)
            inner(node,body)
        if node.tag=='a' and a.get('target')=='_blank' and any(x in (a.get('href') or '') for x in ['2gis.ru/','yandex.ru/maps/']):
            attrs(node, {'href':contact['routeUrl']})
        if node.tag=='script' and a.get('type')=='application/ld+json':
            data=json.loads(source[node.open_end:node.close_start])
            data['telephone']=contact['phone'];data['description']=content['texts']['meta.description']
            data['address']['streetAddress']=contact['address']
            match=re.fullmatch(r'(\d{2}:\d{2})[–-](\d{2}:\d{2})',contact['hours'])
            if match:
                data['openingHoursSpecification'][0].update({'opens':match[1],'closes':match[2]})
            # Natural-language work days can differ from the old structured list.
            data['openingHoursSpecification'][0].pop('dayOfWeek',None)
            data['openingHours']=contact['days']+' '+contact['hours']
            inner(node,json.dumps(data,ensure_ascii=False).replace('<','\\u003c'))
        if a.get('id')=='cms-state':
            state={'active':active and promo['popupEnabled'],'promotionEnd':promo['endDate'],'promotionEnabled':promo['enabled'],'fullPrice':content['prices']['full'],'version':content.get('revision',2),'phone':contact['phone'],'legal':content['legal'],'token':None}
            inner(node,json.dumps(state,ensure_ascii=False).replace('<','\\u003c'))
    for node, values in attributes.values():
        changes.append((node.start, node.open_end, opening(source, node, values)))
    return doc.apply(changes)

def build():
    content=json.loads((ROOT/'content/site.json').read_text(encoding='utf-8'))
    # Shared validation is used by the API and build, before any output is replaced.
    import subprocess
    subprocess.run(['node','backend/validate-file.mjs'],cwd=ROOT,check=True)
    page=render(content)
    output=ROOT/'dist'
    if output.exists():shutil.rmtree(output)
    output.mkdir()
    excluded={'index.html','site-template.html','render_site.py','cms_html.py','README.md','README-CMS.md','README-ADMIN.md','package.json','package-lock.json','.pages.yml','.gitignore'}
    for asset in ROOT.iterdir():
        if asset.is_file() and asset.name not in excluded and not asset.name.startswith('.dev.'):
            shutil.copy2(asset,output/asset.name)
    for directory in ['admin','media','variant-2']:
        if (ROOT/directory).is_dir():shutil.copytree(ROOT/directory,output/directory)
    shutil.copy2(ROOT/'site-template.html',output/'admin/preview-template.html')
    (output/'index.html').write_text(page,encoding='utf-8')
    assert 'href="https://vesnushki-sochi23.ru/"' in page
    print('Rendered dist/index.html and dist/admin/')

if __name__=='__main__':build()
