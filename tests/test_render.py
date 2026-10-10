import copy
import json
import unittest
from datetime import datetime
from pathlib import Path
from cms_html import Document
from render_site import ROOT, MOSCOW, render

class Rendering(unittest.TestCase):
    def setUp(self):
        self.content=json.loads((ROOT/'content/site.json').read_text())
        self.now=datetime(2026,10,10,tzinfo=MOSCOW)
    def page(self,c=None,now=None):
        return Document(render(c or self.content,now=now or self.now))
    def text(self,doc,key):
        return [doc.text(n) for n in doc.nodes if n.attrs.get('data-cms-text')==key]
    def test_every_text_field_is_rendered_and_escaped(self):
        for key in self.content['texts']:
            if key.startswith('meta.'):continue
            c=copy.deepcopy(self.content);c['texts'][key]='Проверка <script>&"'
            doc=self.page(c)
            # Dynamic teacher/gallery containers intentionally replace children.
            self.assertEqual(self.text(doc,key),['Проверка <script>&"']*len(self.text(doc,key)),key)
            self.assertTrue(self.text(doc,key),key)
            self.assertNotIn('<script>&"',doc.source)
    def test_editor_links_match_template_markers(self):
        editor=json.loads((ROOT/'admin/editor.json').read_text())
        template=Document((ROOT/'site-template.html').read_text())
        marked={n.attrs['data-cms-link'] for n in template.nodes if 'data-cms-link' in n.attrs}
        self.assertEqual({f['key'] for f in editor['links']},marked)

    def test_prices_and_promotion_are_consistent(self):
        c=copy.deepcopy(self.content);c['prices']['full']=35000;c['promotion']['price']=30000
        doc=self.page(c)
        for n in doc.nodes:
            if n.attrs.get('data-price')=='full':self.assertEqual(doc.text(n),'30\u00a0000 ₽')
            if n.attrs.get('data-price')=='fullNormal':self.assertEqual(doc.text(n),'35\u00a0000 ₽')
        doc=self.page(c,datetime(2026,12,1,tzinfo=MOSCOW))
        for n in doc.nodes:
            if n.attrs.get('data-price')=='full':self.assertEqual(doc.text(n),'35\u00a0000 ₽')
    def test_teacher_gallery_photo_and_mama_changes_reach_page(self):
        c=copy.deepcopy(self.content);c['teachers'].append({'id':'new','name':'Новый педагог','role':'Логопед','url':'/photo-2.webp','alt':'Новый'})
        c['gallery'].append({'id':'new','url':'/photo-2.webp','alt':'Новая фотография'})
        c['photos']['image25']['url']='/photo-2.webp';c['texts']['mamaBaby.description']='Новое описание группы'
        doc=self.page(c)
        self.assertIn('Новый педагог',doc.source);self.assertIn('Новая фотография',doc.source)
        img=next(n for n in doc.nodes if n.attrs.get('data-cms-photo')=='image25')
        self.assertEqual(img.attrs['src'],'/photo-2.webp');self.assertEqual(self.text(doc,'mamaBaby.description'),['Новое описание группы'])
    def test_contact_updates_phone_routes_map_and_schema(self):
        c=copy.deepcopy(self.content);c['contacts'].update(phone='+7 (999) 123-45-67',address='Новый адрес',hours='08:00–18:00',mapUrl='https://2gis.ru/sochi/geo/12345',routeUrl='https://2gis.ru/sochi/geo/12345')
        doc=self.page(c)
        for n in doc.nodes:
            if n.tag=='a' and n.attrs.get('href','').startswith('tel:'):self.assertEqual(n.attrs['href'],'tel:+79991234567')
        self.assertIn('"id":"12345"',doc.source)
        schema=next(n for n in doc.nodes if n.attrs.get('type')=='application/ld+json')
        data=json.loads(doc.source[schema.open_end:schema.close_start]);self.assertEqual(data['address']['streetAddress'],'Новый адрес');self.assertEqual(data['openingHoursSpecification'][0]['opens'],'08:00')
    def test_required_assets_forms_seo_and_unedited_sections_survive(self):
        doc=self.page();original=Document((ROOT/'site-template.html').read_text())
        for tag,key in [('link','href'),('script','src'),('iframe','src')]:
            values=lambda d:sorted(n.attrs[key] for n in d.nodes if n.tag==tag and key in n.attrs)
            self.assertEqual(values(doc),values(original))
        self.assertIn('href="https://vesnushki-sochi23.ru/"',doc.source)
        self.assertEqual({n.attrs['data-cms-block'] for n in doc.nodes if 'data-cms-block' in n.attrs},set(self.content['blocks']))
    def test_blocks_can_be_hidden_without_losing_other_sections(self):
        c=copy.deepcopy(self.content);c['blocks']['about']=False
        doc=self.page(c);self.assertFalse(any(n.attrs.get('data-cms-block')=='about' for n in doc.nodes));self.assertTrue(any(n.attrs.get('data-cms-block')=='mama-baby' for n in doc.nodes))
    def test_template_mismatch_stops_build(self):
        c=copy.deepcopy(self.content);c['texts']['nonexistent']='bad'
        with self.assertRaises(ValueError):self.page(c)
    def test_popup_can_be_disabled_independently(self):
        c=copy.deepcopy(self.content);c['promotion']['popupEnabled']=False
        doc=self.page(c);state=next(n for n in doc.nodes if n.attrs.get('id')=='cms-state')
        self.assertFalse(json.loads(doc.source[state.open_end:state.close_start])['active'])
        full=next(n for n in doc.nodes if n.attrs.get('data-price')=='full');self.assertEqual(doc.text(full),'27\u00a0900 ₽')

if __name__=='__main__':unittest.main()
