export function HighlightJson({value}:{value:unknown}){
 const json=JSON.stringify(value,null,2);
 const pattern=/("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])/g;
 return <code className="json-highlight">{json.split('\n').map((line,index)=>{
 const parts=[];let offset=0;
 for(const match of line.matchAll(pattern)){
  const start=match.index!;if(start>offset)parts.push(line.slice(offset,start));
  const kind=match[1]?'key':match[2]?'string':match[3]?'number':match[4]?'literal':'punctuation';
  parts.push(<span key={start} className={`json-token-${kind}`}>{match[0]}</span>);offset=start+match[0].length;
 }
 if(offset<line.length)parts.push(line.slice(offset));
 return <span className="json-code-line" key={index}><span className="json-line-number" aria-hidden="true">{index+1}</span><span className="json-line-content">{parts}{'\n'}</span></span>;
 })}</code>;
}
