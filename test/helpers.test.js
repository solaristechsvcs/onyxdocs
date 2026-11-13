const {test}=require('node:test');
const assert=require('node:assert/strict');
const {escape,slug,categoryTree,validParent}=require('../src/helpers');
test('escapes untrusted text used in HTML attributes and content',()=>assert.equal(escape('<script>"x" & \'y\''),'&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;'));
test('slugs cannot introduce route separators or HTML',()=>assert.equal(slug(' A / New <Guide>! '),'a-new-guide'));
test('nested categories retain arbitrary levels',()=>{const rows=[{id:1,parent_id:null},{id:2,parent_id:1},{id:3,parent_id:2}];assert.equal(categoryTree(rows)[0].children[0].children[0].id,3);});
test('category parents reject descendants, self references and missing parents',()=>{const rows=[{id:1,parent_id:null},{id:2,parent_id:1},{id:3,parent_id:2}];assert.equal(validParent(rows,1,3),false);assert.equal(validParent(rows,2,2),false);assert.equal(validParent(rows,4,999),false);assert.equal(validParent(rows,4,3),true);assert.equal(validParent(rows,1,null),true);});
