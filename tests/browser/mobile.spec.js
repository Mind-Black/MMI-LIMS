import { test, expect } from '@playwright/test';

const USER_ID = '11111111-1111-1111-1111-111111111111';

const DEFAULT_TOOLS = [
    {
        id: 1,
        name: 'Test equipment',
        category: 'Metrology',
        rate_category: 'B',
        location: 'Cleanroom A',
        status: 'up',
        license_req: true,
        ms_bookings_sync_enabled: true,
        ms_bookings_email: 'metrology@university.edu',
        ms_bookings_service_id: 'svc-1234-5678',
    },
    {
        id: 2,
        name: 'Atomic Force Microscope',
        category: 'Characterization',
        rate_category: 'C',
        location: 'Analysis Lab',
        status: 'service',
        license_req: false,
        ms_bookings_sync_enabled: false,
    },
];

async function setupSession(
    page,
    {
        approved = true,
        tutorialSeen = true,
        role = 'user',
        users = [],
        tools = DEFAULT_TOOLS,
        bookings = [],
        onRpc,
    } = {},
) {
    if (tutorialSeen) {
        await page.addInitScript(() => localStorage.setItem('mmi_tutorial_seen', 'true'));
    }

    await page.addInitScript(
        ({ id }) => {
            localStorage.setItem(
                'sb-localhost-auth-token',
                JSON.stringify({
                    access_token: 'test-token',
                    refresh_token: 'refresh',
                    expires_at: 4102444800,
                    expires_in: 3600,
                    token_type: 'bearer',
                    user: { id, email: 'a@example.com', aud: 'authenticated' },
                }),
            );
        },
        { id: USER_ID },
    );

    await page.route('http://localhost:54321/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const headers = request.headers();
        let body = [];
        const responseHeaders = { 'Access-Control-Allow-Origin': '*' };

        if (path.includes('/rpc/create_bookings')) {
            const { p_ranges } = request.postDataJSON();
            body = p_ranges.map((r, i) => ({
                ...r,
                id: i + 100,
                user_id: USER_ID,
                user_name: 'Test Member',
                tool_name: tools[0]?.name || 'Test equipment',
                created_at: new Date().toISOString(),
                starts_at: `${r.date}T${r.time}:00Z`,
                ends_at: `${r.date}T${r.end_time}:00Z`,
            }));
        } else if (path.includes('/rpc/has_calendar_token')) {
            body = false;
        } else if (path.includes('/rpc/')) {
            const rpcName = path.split('/rpc/')[1];
            const payload = request.postDataJSON();
            if (onRpc) {
                const custom = await onRpc(rpcName, payload);
                if (custom !== undefined) body = custom;
            }
        } else if (path.includes('profiles')) {
            const single = headers.accept?.includes('vnd.pgrst.object') || url.searchParams.get('id')?.includes(`eq.${USER_ID}`);
            body = single
                ? {
                      id: USER_ID,
                      first_name: 'Test',
                      last_name: 'Member',
                      job_title: 'Scientist',
                      access_level: role,
                      is_approved: approved,
                      licenses: { 1: 'level_3', 2: 'level_3' },
                      projects: ['Photonics'],
                  }
                : users;
        } else if (path.includes('tools')) {
            body = tools;
        } else if (path.includes('bookings')) {
            const idFilter = url.searchParams.get('id');
            const offset = Number(url.searchParams.get('offset') || 0);
            const rangeHeader = headers.range || '';
            const statusFilter = url.searchParams.get('status');
            if (
                (idFilter?.startsWith('gt.') && Number(idFilter.slice(3)) > 0) ||
                offset > 0 ||
                (rangeHeader && !rangeHeader.startsWith('0-'))
            ) {
                body = [];
            } else if (statusFilter === 'eq.pending_approval') {
                body = bookings.filter((b) => b.status === 'pending_approval');
            } else {
                body = bookings;
            }
            if (headers.prefer?.includes('count=exact')) {
                responseHeaders['Content-Range'] = body.length ? `0-${body.length - 1}/${bookings.length}` : `*/${bookings.length}`;
                responseHeaders['Access-Control-Expose-Headers'] = 'Content-Range';
            }
        } else if (path.includes('training_requests') || path.includes('user_invitations')) {
            body = [];
        } else if (path.includes('auth/v1/user')) {
            body = { id: USER_ID, email: 'a@example.com' };
        }

        await route.fulfill({ json: body, headers: responseHeaders });
    });
}

async function assertNoHorizontalOverflow(page) {
    const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe('Mobile UI/UX regressions', () => {
    test.use({ hasTouch: true });

    test('zero horizontal overflow across Login and all Dashboard views on 360x800', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 800 });

        await page.goto('./');
        await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
        await assertNoHorizontalOverflow(page);

        await setupSession(page, { role: 'admin', users: [] });
        for (const view of ['', '?view=tools', '?view=all_bookings', '?view=users', '?view=infrastructure']) {
            await page.goto(`./${view}`);
            await expect(page.getByRole('navigation', { name: 'Mobile Navigation' })).toBeVisible();
            await assertNoHorizontalOverflow(page);
        }
    });

    test('BookingModal on iPhone SE (375x667) keeps actions in viewport, uses >=16px inputs, and positions Toast above bottom nav', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await setupSession(page);
        await page.goto('./?view=tools');

        await page.getByRole('button', { name: 'View availability / Book' }).first().tap();
        const dialog = page.getByRole('dialog', { name: /Book Test equipment/i });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel('Visual week calendar')).toBeHidden();

        const cancelBtn = dialog.getByRole('button', { name: 'Cancel', exact: true });
        const confirmBtn = dialog.getByRole('button', { name: 'Confirm', exact: true });
        await expect(cancelBtn).toBeVisible();
        await expect(confirmBtn).toBeVisible();

        const cancelBox = await cancelBtn.boundingBox();
        const confirmBox = await confirmBtn.boundingBox();
        expect(cancelBox.y).toBeGreaterThanOrEqual(0);
        expect(cancelBox.y + cancelBox.height).toBeLessThanOrEqual(667);
        expect(confirmBox.y).toBeGreaterThanOrEqual(0);
        expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(667);
        expect(confirmBox.x + confirmBox.width).toBeLessThanOrEqual(375);

        for (const label of ['Date', 'Start', 'End', 'Project']) {
            const fontSize = await dialog.getByLabel(label, { exact: true }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
            expect(fontSize).toBeGreaterThanOrEqual(16);
        }

        await dialog.getByLabel('Date', { exact: true }).fill('2035-01-15');
        await dialog.getByLabel('Start', { exact: true }).selectOption('10:00');
        await dialog.getByLabel('End', { exact: true }).selectOption('11:00');
        await dialog.getByRole('button', { name: 'Check & Apply Time' }).tap();
        await confirmBtn.tap();

        const toast = page.getByRole('status').filter({ hasText: 'Successfully created 1 reservation(s).' });
        await expect(toast).toBeVisible();
        await expect(async () => {
            const toastBox = await toast.boundingBox();
            const navBox = await page.getByRole('navigation', { name: 'Mobile Navigation' }).boundingBox();
            expect(toastBox.x).toBeGreaterThanOrEqual(0);
            expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(375);
            expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(navBox.y);
        }).toPass();
    });

    test('tapping an existing future reservation on mobile (375x667) exposes Cancel Reservation and Update in viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await setupSession(page, {
            bookings: [
                {
                    id: 501,
                    tool_id: 1,
                    tool_name: 'Test equipment',
                    user_id: USER_ID,
                    user_name: 'Test Member',
                    project: 'Photonics',
                    date: '2035-01-15',
                    time: '10:00',
                    end_time: '11:00',
                    starts_at: '2035-01-15T08:00:00Z',
                    ends_at: '2035-01-15T09:00:00Z',
                    status: 'confirmed',
                    created_at: '2026-11-19T10:00:00Z',
                },
            ],
        });

        await page.goto('./');
        const agendaDateInput = page.getByLabel('Agenda date');
        await agendaDateInput.fill('2035-01-15');
        await page.getByRole('button', { name: /10:00–11:00 · Test equipment/ }).tap();

        const dialog = page.getByRole('dialog', { name: /Book Test equipment/i });
        await expect(dialog).toBeVisible();

        const cancelResBtn = dialog.getByRole('button', { name: 'Cancel Reservation' });
        const updateBtn = dialog.getByRole('button', { name: 'Update', exact: true });
        await expect(cancelResBtn).toBeVisible();
        await expect(updateBtn).toBeVisible();

        const cancelResBox = await cancelResBtn.boundingBox();
        const updateBox = await updateBtn.boundingBox();
        expect(cancelResBox.height).toBeGreaterThanOrEqual(44);
        expect(updateBox.y + updateBox.height).toBeLessThanOrEqual(667);
    });

    test('UserManagement opens as an immediate mobile sheet with 2x2 >=40px license buttons on 360x800', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        const member = {
            id: '22222222-2222-2222-2222-222222222222',
            first_name: 'Lab',
            last_name: 'Member',
            email: 'very.long.researcher.name@materials.institute.university.edu',
            access_level: 'user',
            is_approved: true,
            licenses: { 1: 'level_1' },
            projects: ['Graphene'],
        };
        let savedPayload = null;
        await setupSession(page, {
            role: 'admin',
            users: [member],
            onRpc: (name, payload) => {
                if (name === 'set_user_tool_license') {
                    savedPayload = payload;
                    return { licenses: { 1: payload.p_level } };
                }
                return undefined;
            },
        });

        await page.goto('./?view=users');
        await page.getByRole('button', { name: 'Manage Access' }).first().tap();

        const closeBtn = page.getByRole('button', { name: 'Close user details' });
        const licenseList = page.getByRole('list', { name: 'Equipment licenses' });
        await expect(closeBtn).toBeVisible();
        await expect(licenseList).toBeVisible();

        const closeBox = await closeBtn.boundingBox();
        expect(closeBox.y).toBeGreaterThanOrEqual(0);
        expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(800);

        const testEquipRow = licenseList.getByRole('listitem').filter({ hasText: 'Test equipment' });
        for (const label of ['None', 'Level I', 'Level II', 'Level III']) {
            const btn = testEquipRow.getByRole('button', { name: label, exact: true });
            const box = await btn.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(40);
            expect(box.x + box.width).toBeLessThanOrEqual(360);
        }

        const rpcDone = page.waitForResponse('**/rpc/set_user_tool_license');
        await testEquipRow.getByRole('button', { name: 'Level III', exact: true }).tap();
        await rpcDone;
        expect(savedPayload).toEqual({ p_user_id: member.id, p_tool_id: 1, p_level: 'level_3' });
        await assertNoHorizontalOverflow(page);

        await closeBtn.tap();
        await expect(closeBtn).toHaveCount(0);
    });

    test('InfrastructureManagement renders mobile cards and keeps MS Bookings Sync modal within 360px', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await setupSession(page, { role: 'admin' });
        await page.goto('./?view=infrastructure');

        await assertNoHorizontalOverflow(page);
        await expect(page.getByRole('region', { name: 'Laboratory infrastructure table' })).toBeHidden();
        await expect(page.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete' }).first()).toBeVisible();

        await page.getByRole('button', { name: 'MS Bookings Sync' }).first().tap();
        const syncDialog = page.getByRole('dialog', { name: /Microsoft Bookings Power Automate Setup/i });
        await expect(syncDialog).toBeVisible();
        await assertNoHorizontalOverflow(page);

        const dialogOverflow = await syncDialog.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(dialogOverflow).toBeLessThanOrEqual(1);

        const copyButtons = syncDialog.getByRole('button', { name: /^Copy/ });
        const count = await copyButtons.count();
        expect(count).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < count; i++) {
            const box = await copyButtons.nth(i).boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(360);
        }
    });

    test('Secondary modals fit within 375x667 and 390x844 viewports without horizontal overflow', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await setupSession(page, { role: 'admin' });
        await page.goto('./');

        await page.getByRole('button', { name: 'Menu', exact: true }).tap();
        await page.getByRole('button', { name: 'Tutorial' }).tap();
        const tutorialDialog = page.getByRole('dialog', { name: 'Quick-start tutorial' });
        await expect(tutorialDialog).toBeVisible();
        const tutBox = await tutorialDialog.boundingBox();
        expect(tutBox.y).toBeGreaterThanOrEqual(0);
        expect(tutBox.y + tutBox.height).toBeLessThanOrEqual(667);
        await assertNoHorizontalOverflow(page);
        await tutorialDialog.getByRole('button', { name: 'Close tutorial' }).tap();

        await page.getByRole('button', { name: 'Menu', exact: true }).tap();
        await page.getByRole('button', { name: 'Rates & Pricing' }).tap();
        const pricingDialog = page.getByRole('dialog', { name: /Equipment Rate Categories & Access Modes/i });
        await expect(pricingDialog).toBeVisible();
        await expect(pricingDialog.getByRole('region', { name: 'Hourly service rates matrix' })).toBeHidden();
        await expect(pricingDialog.getByText('Hourly Rates').first()).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await pricingDialog.getByRole('button', { name: 'Close rate guide' }).tap();

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('./?view=users');
        await page.getByRole('button', { name: 'Invite User' }).tap();
        const inviteDialog = page.getByRole('dialog', { name: 'Invite New User' });
        await expect(inviteDialog).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await inviteDialog.getByRole('button', { name: 'Close invite modal' }).tap();

        await page.goto('./?view=infrastructure');
        await page.getByRole('button', { name: 'Add Equipment' }).tap();
        const addDialog = page.getByRole('dialog', { name: 'Add Laboratory Infrastructure' });
        await expect(addDialog).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await addDialog.getByRole('button', { name: 'Close dialog' }).tap();
    });
});
