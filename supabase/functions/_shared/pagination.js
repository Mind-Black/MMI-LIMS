/** Keyset pagination avoids API row caps and offset drift when older rows are deleted. */
export async function fetchAllById(makeQuery) {
 const rows=[];
 let cursor=0;
 for(;;) {
  const {data,error}=await makeQuery().gt('id',cursor).order('id').limit(500);
  if(error) throw error;
  if(!data?.length) return rows;
  rows.push(...data);
  const next=data[data.length-1].id;
  if(next<=cursor) throw new Error('Invalid pagination cursor');
  cursor=next;
 }
}
