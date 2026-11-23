import React from 'react';
export function Link({children,...props}:any) {return <a {...props}>{children}</a>}
export function Image({unoptimized,fill,priority,sizes,...props}:any) {return <img {...props}/>}
export function useParams<T = {id:string}>():T {return {id:location.pathname.split('/').filter(Boolean).at(-1)!} as T}
export default Link;
