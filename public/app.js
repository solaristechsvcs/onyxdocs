const discordContinue=document.querySelector('a[data-discord-authorize]');
if(discordContinue){const target=new URL(discordContinue.href);if(target.origin==='https://discord.com' && target.pathname==='/oauth2/authorize')window.location.assign(target.href);}
try { if(localStorage.getItem('onyx-theme')==='light') document.documentElement.classList.add('light'); } catch {}
document.querySelector('#theme-toggle')?.addEventListener('click',()=>{const light=document.documentElement.classList.toggle('light');try{localStorage.setItem('onyx-theme',light?'light':'dark');}catch{}});
const toc = document.querySelector('#toc');
if (toc) document.querySelectorAll('.prose h2,.prose h3').forEach((heading,i)=>{heading.id='section-'+i;const link=document.createElement('a');link.href='#'+heading.id;link.textContent=heading.textContent;link.className=heading.tagName.toLowerCase();toc.append(link);});
document.querySelectorAll('.prose pre').forEach(pre=>{const button=document.createElement('button');button.textContent='Copy';button.className='copy';button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent);button.textContent='Copied';setTimeout(()=>button.textContent='Copy',1500);}catch{button.textContent='Select text to copy';}});pre.append(button);});
