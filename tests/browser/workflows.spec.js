import {test,expect} from '@playwright/test';
const id='11111111-1111-1111-1111-111111111111';
async function session(page,approved,{tutorialSeen=true,role='user',users=[],tools=[{id:1,name:'Test equipment',category:'Metrology',status:'up',license_req:true}]}={}) {
 if(tutorialSeen) await page.addInitScript(()=>localStorage.setItem('mmi_tutorial_seen','true'));
 await page.addInitScript(({id})=>localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id,email:'a@example.com',aud:'authenticated'}})),{id});
 await page.route('http://localhost:54321/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 let body=[];
 if(path.includes('profiles')) {
 const single=route.request().headers().accept?.includes('vnd.pgrst.object');
 body=single ? {id,first_name:'Test',last_name:'Member',job_title:'Scientist',access_level:role,is_approved:approved,licenses:{'1':'level_3'},projects:[]} : users;
 }
 if(path.includes('tools')) body=tools;
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

test('admin searches and sorts equipment and saves the license for the matching row', async ({ page }) => {
    const member = {
        id: '22222222-2222-2222-2222-222222222222', first_name: 'Lab', last_name: 'Member',
        access_level: 'user', is_approved: true, licenses: ['12'], projects: [],
    };
    const tools = [
        { id: 12, name: 'Zeiss', category: 'Imaging' },
        { id: 4, name: 'Alpha', category: 'Metrology' },
        { id: 7, name: 'Beta', category: 'Imaging' },
    ].map(tool => ({ ...tool, status: 'up', license_req: true }));
    await session(page, true, { role: 'admin', users: [member], tools });
    let savedLicense;
    await page.route('**/rpc/set_user_tool_license', async route => {
        savedLicense = route.request().postDataJSON();
        await route.fulfill({ json: { licenses: { 12: 'level_3', 7: 'level_3' } } });
    });
    await page.goto('./?view=users');
    await page.getByRole('button', { name: 'Manage Access' }).click();

    const search = page.getByRole('searchbox', { name: 'Search equipment' });
    const sort = page.getByLabel('Sort equipment');
    const rows = page.getByRole('list', { name: 'Equipment licenses' }).getByRole('listitem');
    await expect(rows).toHaveText([/Alpha/, /Beta/, /Zeiss/]);
    await sort.selectOption('name-desc');
    await expect(rows).toHaveText([/Zeiss/, /Beta/, /Alpha/]);
    await sort.selectOption('category');
    await expect(rows).toHaveText([/Beta/, /Zeiss/, /Alpha/]);
    await sort.selectOption('license');
    await expect(rows).toHaveText([/Zeiss/, /Alpha/, /Beta/]);

    await search.fill('  IMAGING ');
    await expect(rows).toHaveText([/Zeiss/, /Beta/]);
    await rows.filter({ hasText: 'Beta' }).getByRole('button', { name: 'Level III', exact: true }).click();
    await expect(rows).toHaveText([/Beta/, /Zeiss/]);
    expect(savedLicense).toEqual({ p_user_id: member.id, p_tool_id: 7, p_level: 'level_3' });
    await expect(search).toHaveValue('  IMAGING ');
    await expect(sort).toHaveValue('license');

    await search.fill('12');
    await expect(rows).toHaveText([/Zeiss/]);
    await search.fill('unknown');
    await expect(page.getByText('No equipment matches your search.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear equipment search' }).click();
    await expect(rows).toHaveCount(3);
    await search.fill('beta');
    await expect(rows).toHaveText([/Beta/]);
    await page.getByRole('button', { name: 'Close user details' }).click();
    await page.getByRole('button', { name: 'Manage Access' }).click();
    await expect(search).toHaveValue('');
    await expect(sort).toHaveValue('name-asc');
});
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
test('admin can send and revoke user invitations in User Management',async({page})=>{
 const pendingInvites=[];
 await page.addInitScript(()=>localStorage.setItem('mmi_tutorial_seen','true'));
 await page.addInitScript(({id})=>localStorage.setItem('sb-localhost-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id,email:'admin@example.com',aud:'authenticated'}})),{id});
 await page.route('http://localhost:54321/**',async route=>{
  const url=new URL(route.request().url());
  const path=url.pathname;
  let body=[];
  if(path.includes('profiles') && url.searchParams.get('id')?.includes('eq.')) {
   body={id,first_name:'Admin',last_name:'User',job_title:'Chief Researcher',access_level:'admin',is_approved:true,licenses:{},projects:[]};
  } else if(path.includes('profiles')) {
   body=[{id,first_name:'Admin',last_name:'User',email:'admin@example.com',job_title:'Chief Researcher',access_level:'admin',is_approved:true,licenses:{},projects:[]}];
  } else if(path.includes('tools')) {
   body=[{id:1,name:'Test equipment',category:'Metrology',status:'up',license_req:true}];
  } else if(path.includes('user_invitations')) {
   body=[...pendingInvites];
  } else if(path.includes('functions/v1/invite-user')) {
   const payload=route.request().postDataJSON();
   if(payload.action==='send') {
    const inv={id:'inv-1',email:payload.email,first_name:payload.first_name,last_name:payload.last_name,job_title:payload.job_title,projects:payload.projects||[],status:'pending',expires_at:'2035-01-20T00:00:00Z',last_sent_at:'2035-01-13T00:00:00Z',created_at:'2035-01-13T00:00:00Z'};
    pendingInvites.unshift(inv);
    body={success:true,invitation:inv};
   }
  } else if(path.includes('revoke_user_invitation')) {
   pendingInvites.length=0;
   body={id:'inv-1',status:'revoked'};
  } else if(path.includes('has_calendar_token')) {
   body=false;
  } else if(path.includes('auth/v1/user')) {
   body={id,email:'admin@example.com'};
  }
  await route.fulfill({json:body,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.goto('./?view=users');
 await page.getByRole('button',{name:'Invite User'}).click();
 await page.getByLabel(/Email Address/).fill('new.researcher@example.com');
 await page.getByLabel(/First Name/).fill('Marie');
 await page.getByLabel(/Last Name/).fill('Curie');
 await page.getByLabel(/Job Title/).selectOption('Researcher');
 await page.getByRole('button',{name:'Send Invitation'}).click();
 await expect(page.getByText('Invitation sent to new.researcher@example.com.')).toBeVisible();
 await expect(page.getByText('Pending Invitations (1)')).toBeVisible();
 await page.getByRole('button',{name:'Revoke'}).click();
 await expect(page.getByText('Invitation for new.researcher@example.com revoked.')).toBeVisible();
});
test('invited user can complete setup via invitation link',async({page})=>{
 const token='c'.repeat(64);
 await page.addInitScript(()=>localStorage.setItem('mmi_tutorial_seen','true'));
 await page.route('http://localhost:54321/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let body={};
  if(path.includes('get_invitation_by_token')) {
   body={id:'inv-2',email:'invited@example.com',first_name:'Grace',last_name:'Hopper',job_title:'Senior Researcher',projects:['Compilers'],expires_at:'2035-01-20T00:00:00Z'};
  } else if(path.includes('functions/v1/invite-user')) {
   const payload=route.request().postDataJSON();
   expect(payload.action).toBe('accept');
   expect(payload.token).toBe(token);
   body={success:true,email:'invited@example.com',userId:id};
  } else if(path.includes('auth/v1/token')) {
   body={access_token:'test-token',refresh_token:'refresh',expires_in:3600,token_type:'bearer',user:{id,email:'invited@example.com',aud:'authenticated'}};
  } else if(path.includes('profiles')) {
   body={id,first_name:'Grace',last_name:'Hopper',job_title:'Senior Researcher',access_level:'user',is_approved:true,licenses:{},projects:['Compilers']};
  } else if(path.includes('tools')) {
   body=[];
  } else if(path.includes('has_calendar_token')) {
   body=false;
  }
  await route.fulfill({json:body,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.goto(`./?invite=${token}`);
 await expect(page.getByRole('heading',{name:'Accept Invitation'})).toBeVisible();
 await expect(page.getByLabel('Email Address')).toHaveValue('invited@example.com');
 await expect(page.getByLabel('First Name')).toHaveValue('Grace');
 await page.getByLabel('Password').fill('SecurePass123!');
 await page.getByRole('button',{name:'Complete Setup & Sign In'}).click();
 await expect(page.getByText('Welcome to MMI-LIMS! Your account is active.')).toBeVisible();
});
