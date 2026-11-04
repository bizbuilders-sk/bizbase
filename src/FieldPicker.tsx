import {useEntityColor} from './EntityTheme.tsx';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Check,Search} from 'lucide-react';
import type {Field} from './workspace-model.ts';
import {fieldMatchesQuery} from './field-search.ts';

// The same chooser serves list grouping, boards and condition fields.
export default function FieldPicker({fields,value,onChange,label,emptyLabel,disabled=false}:{fields:Field[];value:string;onChange:(key:string)=>void;label:string;emptyLabel?:string;disabled?:boolean}){
 const entity=useEntityColor();
 const [opened,setOpened]=useState(false),[query,setQuery]=useState('');const button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);const [position,setPosition]=useState({top:0,left:0,width:360,maxHeight:420});
 const chosen=fields.find(field=>field.key===value);
 useEffect(()=>{if(!opened)return;
  function place(){const rect=button.current!.getBoundingClientRect(),width=Math.min(420,window.innerWidth-24),height=Math.min(440,window.innerHeight-24);const below=window.innerHeight-rect.bottom-12;setPosition({width,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:below>220?rect.bottom+6:Math.max(12,rect.top-height-6),maxHeight:below>220?Math.min(height,below):height});}
  function outside(event:MouseEvent){if(!panel.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node))setOpened(false);}
  place();search.current?.focus();document.addEventListener('mousedown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{document.removeEventListener('mousedown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[opened]);
 function choose(key:string){onChange(key);setOpened(false);button.current?.focus();}
 const visible=fields.filter(field=>fieldMatchesQuery(field,query));
 const sections=[...new Set(visible.map(field=>field.groupSection||'Fields'))];
 const option=(field:Field)=><button type="button" role="option" aria-selected={field.key===value} key={field.key} onClick={()=>choose(field.key)} onKeyDown={event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const options=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role=option]')||[]).filter(item=>item.offsetParent!==null),at=options.indexOf(event.currentTarget);options[event.key==='Home'?0:event.key==='End'?options.length-1:(at+(event.key==='ArrowDown'?1:options.length-1))%options.length]?.focus();}}}><span>{field.label}</span>{field.key===value&&<Check size={14}/>}</button>;
 const contents=sections.map(section=>section==='TBD'?<details className="picker-deferred" key={section} open={query?true:undefined}><summary>TBD</summary>{visible.filter(field=>field.groupSection===section).map(option)}</details>:<section key={section}><strong>{section}</strong>{visible.filter(field=>(field.groupSection||'Fields')===section).map(option)}</section>);
 return <><button ref={button} type="button" className="filter-select field-picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={opened} title={chosen?.label} disabled={disabled} onClick={()=>{setQuery('');setOpened(!opened);}}><span>{chosen?.label||emptyLabel||'Choose field'}</span><ChevronDown size={14}/></button>{opened&&createPortal(<div ref={panel} data-entity={entity} data-field-picker="true" className="field-picker-menu" style={{position:'fixed',...position}} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){setOpened(false);button.current?.focus();}if(event.key==='ArrowDown'&&event.target===search.current){event.preventDefault();Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role=option]')||[]).find(item=>item.offsetParent!==null)?.focus();}if(event.key==='Tab'){const items=Array.from(panel.current?.querySelectorAll<HTMLElement>('input,button,summary')||[]).filter(item=>item.offsetParent!==null),first=items[0],last=items.at(-1);if(event.shiftKey&&event.target===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&event.target===last){event.preventDefault();first?.focus();}}}}><label className="field-picker-search"><Search size={14}/><input ref={search} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a field…" aria-label="Find a field"/></label><div role="listbox" aria-label={label}>{emptyLabel&&!query&&<button type="button" role="option" aria-selected={!value} onClick={()=>choose('')}>{emptyLabel}</button>}{contents}{!visible.length&&<p className="relation-empty">No matching fields</p>}</div></div>,document.body)}</>;
}
