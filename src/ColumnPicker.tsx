import {useEntityColor} from './EntityTheme.tsx';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Search,SlidersHorizontal,X} from 'lucide-react';
import type {Field} from './workspace-model.ts';
import {fieldMatchesQuery} from './field-search.ts';

export default function ColumnPicker({fields,value,onChange,onReset}:{fields:Field[];value:string[];onChange:(keys:string[])=>void;onReset:()=>void}){
 const entity=useEntityColor();
 const [opened,setOpened]=useState(false),[query,setQuery]=useState('');
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
    const [position,setPosition]=useState({top:0,left:0,width:360,maxHeight:440});
 function close(){setOpened(false);trigger.current?.focus();}
 useEffect(()=>{
  if(!opened)return;
  function place(){const rect=trigger.current!.getBoundingClientRect(),width=Math.min(380,window.innerWidth-24),height=Math.min(520,window.innerHeight-24),below=window.innerHeight-rect.bottom-12;setPosition({width,left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),top:below>240?rect.bottom+6:Math.max(12,rect.top-height-6),maxHeight:below>240?Math.min(height,below):height});}
  function outside(event:MouseEvent){if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpened(false);}
  place();search.current?.focus();document.addEventListener('mousedown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{document.removeEventListener('mousedown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[opened]);
 const visible=fields.filter(field=>fieldMatchesQuery(field,query));
 const sections=[...new Set(visible.map(field=>field.groupSection||'Fields'))];
 return <><button ref={trigger} className="control-button" aria-haspopup="dialog" aria-expanded={opened} onClick={()=>{setQuery('');setOpened(!opened);}}><SlidersHorizontal size={14}/>Columns</button>{opened&&createPortal(<div ref={panel} data-entity={entity} role="dialog" aria-label="Visible columns" className="column-picker-menu" style={{position:'fixed',...position}} onKeyDown={event=>{
  event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){const items=Array.from(panel.current?.querySelectorAll<HTMLElement>('input,button,summary')||[]).filter(item=>item.offsetParent!==null),first=items[0],last=items.at(-1);if(event.shiftKey&&event.target===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&event.target===last){event.preventDefault();first?.focus();}}
 }}><header><strong>Columns</strong><button type="button" className="icon-button" aria-label="Close columns" onClick={close}><X size={16}/></button></header><label className="field-picker-search"><Search size={14}/><input ref={search} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a column…" aria-label="Find a column"/></label><div className="column-picker-options">{sections.map(section=>{const choices=visible.filter(field=>(field.groupSection||'Fields')===section).map(field=><label key={field.key}><input type="checkbox" checked={value.includes(field.key)} onChange={event=>onChange(event.target.checked?[...value,field.key]:value.filter(key=>key!==field.key))}/><span>{field.label}</span></label>);return section==='TBD'?<details className="picker-deferred" key={section} open={query?true:undefined}><summary>TBD</summary>{choices}</details>:<section key={section}><strong>{section}</strong>{choices}</section>;})}{!visible.length&&<p className="relation-empty">No matching columns</p>}</div><footer><button type="button" className="text-button" onClick={onReset}>Reset columns</button><button type="button" className="button" onClick={close}>Done</button></footer></div>,document.body)}</>;
}
