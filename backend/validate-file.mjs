import {readFile} from 'node:fs/promises';
import {validate,imagePaths} from './validation.mjs';
const c=validate(JSON.parse(await readFile(new URL('../content/site.json',import.meta.url),'utf8')));
for(const path of imagePaths(c))await readFile(new URL('..'+path,import.meta.url));
console.log('Validated content and image files');
