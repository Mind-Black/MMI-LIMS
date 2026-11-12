import {test,expect} from '@playwright/test';
const id='11111111-1111-1111-1111-111111111111';
async function session(page,approved,{tutorialSeen=true}={}) {
 if(tutorialSeen) await page.addInitScript(()=>localStorage.setItem('mmi_tutorial_seen','true'));
 await page.addInitScript(({id})=>localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id,email:'a@example.com',aud:'authenticated'}})),{id});
 await page.route('http://localhost:54321/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 let body=[];
 if(path.includes('profiles')) body={id,first_name:'Test',last_name:'Member',job_title:'Scientist',access_level:'user',is_approved:approved,licenses:{'1':'level_3'},projects:[]};
 if(path.includes('tools')) body=[{id:1,name:'Test equipment',category:'Metrology',status:'up',license_req:true}];
 if(path.includes('has_calendar_token')) body=false;
 if(path.includes('auth/v1/user')) body={id,email:'a@example.com'};
 if(path.includes('create_bookings')) {
 const {p_ranges}=route.request().postDataJSON();
 expect(p_ranges).toHaveLength(1);expect(p_ranges[0]).not.toHaveProperty('user_id');
 body=p_ranges.map((r,i)=>({...r,id:i+1,user_id:id,user_name:'Test Member',tool_name:'Test equipment',created_at:new Date().toISOString(),starts_at:r.date+'T10:00:00Z',ends_at:r.date+'T11:00:00Z'}));
 }
 await route.fulfill({json:body,headers:{'Access-Control-Allow-Origin':'*'}});
 });
}
test('pending account stays outside the booking interface',async({page})=>{
 await session(page,false);await page.goto('./');await expect(page.getByRole('heading',{name:'Account Pending Approval'})).toBeVisible();await expect(page.getByRole('button',{name:'Confirm',exact:true})).toHaveCount(0);
});
test('licensed user books with the server command through the accessible form',async({page})=>{
 await session(page,true);await page.goto('./?view=tools');
 await page.getByRole('button',{name:/^Book$/}).first().click();
 await page.getByLabel('Date',{exact:true}).fill('2035-01-15');
 await page.getByLabel('Start',{exact:true}).selectOption('10:00');await page.getByLabel('End',{exact:true}).selectOption('11:00');
 await expect(page.getByRole('button',{name:'Check & Apply Time'})).toBeEnabled();await page.getByRole('button',{name:'Check & Apply Time'}).click();
 await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByText('Successfully created 1 reservation(s).')).toBeVisible();
});
test('quick-start tutorial opens once on first visit and can be completed',async({page})=>{
 await session(page,true,{tutorialSeen:false});await page.goto('./');
 const dialog=page.getByRole('dialog',{name:'Quick-start tutorial'});
 await expect(dialog).toBeVisible();await expect(dialog.getByText('Step 1 of',{exact:false})).toBeVisible();
 await expect(dialog.getByRole('heading',{name:'Administration'})).toHaveCount(0);
 while(await dialog.getByRole('button',{name:'Next'}).count()) await dialog.getByRole('button',{name:'Next'}).click();
 await expect(dialog.getByRole('heading',{name:"You're all set"})).toBeVisible();
 await dialog.getByRole('button',{name:'Finish'}).click();await expect(dialog).toHaveCount(0);
 await page.reload();await expect(page.getByRole('button',{name:'Tutorial',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Quick-start tutorial'})).toHaveCount(0);
});
test('sidebar tutorial entry opens the tour and jumps to a page',async({page})=>{
 await session(page,true);await page.goto('./');
 await expect(page.getByRole('dialog',{name:'Quick-start tutorial'})).toHaveCount(0);
 await page.getByRole('button',{name:'Tutorial',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Quick-start tutorial'});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:/Step 3:/}).click();
 await dialog.getByRole('button',{name:'Go to Equipment List'}).click();
 await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(/view=tools/);
});
