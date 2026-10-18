import {ROOT_LISTS,validateSnapshot} from './migration-core.mjs';

const typeSuffix=/\s*\((?:currency|money|number|text|short text|long text|text area|drop ?down|labels|date|email|phone|url|checkbox|relationship|tasks|custom field)\)\s*$/i;
const cleanHeader=s=>String(s).trim().replace(typeSuffix,'').trim();
const key=s=>cleanHeader(s).toLowerCase().replace(/[^a-z0-9]/g,'');

// Read cells as text. No formula evaluation, number coercion or date guessing.
export function parseCsv(text) {
  text=String(text).replace(/^\uFEFF/,'');
  if(!text.trim())throw Error('The CSV is empty.');
  let quoted=false;
  const counts={',':0,';':0,'\t':0};
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;}
    else if(!quoted&&(c==='\n'||c==='\r'))break;
    else if(!quoted&&Object.hasOwn(counts,c))counts[c]++;
  }
  const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  if(!counts[delimiter])throw Error('The CSV needs column headings separated by commas, semicolons or tabs.');
  const rows=[];let row=[],field='',inQuotes=false,closedQuote=false;
  const cell=()=>{row.push(field);field='';closedQuote=false;};
  const line=()=>{cell();if(row.some(c=>c!==''))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(inQuotes) {
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"'){inQuotes=false;closedQuote=true;}
      else field+=c;
      continue;
    }
    if(c===delimiter){cell();continue;}
    if(c==='\r'||c==='\n'){line();if(c==='\r'&&text[i+1]==='\n')i++;continue;}
    if(closedQuote){if(c===' '||c==='\t')continue;throw Error(`Unexpected character after a closing quote near CSV row ${rows.length+1}.`);}
    if(c==='"'){if(field!=='')throw Error(`Unexpected quote near CSV row ${rows.length+1}.`);inQuotes=true;}
    else field+=c;
  }
  if(inQuotes)throw Error('The CSV has an unclosed quoted field.');
  if(row.length||field!==''||closedQuote)line();
  if(rows.length<2)throw Error('The CSV has headings but no task rows.');
  const headers=rows.shift();
  rows.forEach((r,i)=>{if(r.length!==headers.length)throw Error(`CSV row ${i+2} has ${r.length} cells; the header has ${headers.length}. Export the original CSV again without editing it.`);});
  return {headers,rows,delimiter};
}

function oneColumn(headers,aliases,required=false) {
  const indexes=headers.map((h,i)=>aliases.includes(key(h))?i:-1).filter(i=>i>=0);
  if(indexes.length>1)throw Error(`Several columns match ${aliases[0]}; the mapping is ambiguous.`);
  if(required&&indexes.length===0)throw Error(`Missing ${aliases[0]==='taskid'?'Task ID':'Task Name'} column. Export All columns from ClickUp.`);
  return indexes[0]??-1;
}
function taskId(value,row) {
  const text=String(value).trim(),url=text.match(/^https:\/\/app\.clickup\.com\/t\/(?:\d+\/)?([a-zA-Z0-9_-]+)(?:[?#].*)?$/);
  const id=url?url[1]:text;
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id))throw Error(`CSV row ${row} has no valid native ClickUp Task ID. Names are not used for matching.`);
  return id;
}
function checkLocation(value,scope,row) {
  const text=value.trim();if(!text)return;
  const urlId=text.match(/\/li\/([0-9]+)(?:[/?#]|$)/)?.[1];
  const leaf=text.split(/\s*[>›/]\s*/).filter(Boolean).at(-1)?.trim();
  if(text!==scope.id&&urlId!==scope.id&&String(leaf).toUpperCase()!==scope.name)throw Error(`CSV row ${row} belongs to “${text}”, not ${scope.name}. Export one 01 ROOT list per file and choose that list in the preview.`);
  if(/\b02\s+projects\b/i.test(text))throw Error('02 PROJECTS is outside the selected import scope.');
}

export function csvToSnapshot(text,listId,fileName='clickup.csv',expectedTotal=0) {
  const scope=ROOT_LISTS.find(l=>l.id===listId);
  if(!scope)throw Error('Choose an approved list in DELIVERY CONSOLE / 01 ROOT.');
  const csv=parseCsv(text),{headers,rows}=csv;
  const idColumn=oneColumn(headers,['taskid'],true),nameColumn=oneColumn(headers,['taskname','name'],true);
  const core={
    status:oneColumn(headers,['status','taskstatus']),description:oneColumn(headers,['description','taskcontent','taskdescription']),
    parent:oneColumn(headers,['parenttaskid','parentid']),task_type:oneColumn(headers,['tasktype']),
    date_created:oneColumn(headers,['datecreated','createddate']),date_updated:oneColumn(headers,['dateupdated','updateddate','lastupdated']),
    date_closed:oneColumn(headers,['dateclosed','closeddate']),start_date:oneColumn(headers,['startdate']),due_date:oneColumn(headers,['duedate'])
  };
  const listColumns=headers.map((h,i)=>['list','listname','listid'].includes(key(h))?i:-1).filter(i=>i>=0);
  const folderColumn=oneColumn(headers,['folder','foldername']),spaceColumn=oneColumn(headers,['space','spacename']);
  const coreIndexes=new Set([idColumn,nameColumn,...Object.values(core),...listColumns,folderColumn,spaceColumn]);
  const records=[],seen=new Map();let duplicates=0;
  rows.forEach((cells,index)=>{
    const row=index+2,id=taskId(cells[idColumn],row),name=cells[nameColumn];
    if(!name.trim())throw Error(`CSV row ${row} has no task name.`);
    for(const c of listColumns)checkLocation(cells[c],scope,row);
    if(folderColumn>=0&&cells[folderColumn].trim()&&cells[folderColumn].trim().toUpperCase()!=='01 ROOT')throw Error(`CSV row ${row} is outside the 01 ROOT folder.`);
    if(spaceColumn>=0&&cells[spaceColumn].trim()&&cells[spaceColumn].trim().toUpperCase()!=='DELIVERY CONSOLE')throw Error(`CSV row ${row} is outside DELIVERY CONSOLE.`);
    const serialized=JSON.stringify(cells);
    if(seen.has(id)){if(seen.get(id)!==serialized)throw Error(`Task ${id} appears more than once with different values. Resolve the conflicting rows before import.`);duplicates++;return;}
    seen.set(id,serialized);
    const raw={id,name,list:{id:scope.id,name:scope.name},folder:{name:'01 ROOT'},space:{name:'DELIVERY CONSOLE'},custom_fields:[],_csv:{file_name:fileName,headers:[...headers],cells:[...cells],delimiter:csv.delimiter,relationship_mapping:'unresolved'}};
    for(const [property,column] of Object.entries(core))if(column>=0)raw[property]=property==='parent'&&cells[column].trim()?taskId(cells[column],row):cells[column];
    headers.forEach((header,column)=>{if(!coreIndexes.has(column))raw.custom_fields.push({id:`csv-column-${column}`,name:cleanHeader(header)||`Unnamed column ${column+1}`,type:'short_text',value:cells[column]});});
    records.push({source_container_id:scope.id,source_container_name:scope.name,record_type:scope.type,source_record_id:id,raw_record:raw});
  });
  const snapshot={format:'bizbase.clickup.v1',source_format:'clickup.csv.v1',exported_at:new Date().toISOString(),source_space:'DELIVERY CONSOLE',source_folder:'01 ROOT',record_count:records.length,expected_record_count:Math.max(expectedTotal,records.length),type_configs:{},records};
  validateSnapshot(snapshot);
  return {snapshot,headers,samples:records.slice(0,5).map(r=>r.raw_record._csv.cells),duplicates,rowCount:rows.length};
}
