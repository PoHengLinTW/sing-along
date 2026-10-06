import { expect, test } from '@playwright/test';
import { apiCreateProject, apiUploadTrack } from '../support/api';
import { deleteProjectsAfterEachTest } from '../support/cleanup';
import { createProjectViaUi, uniqueTitle } from '../support/ui';

deleteProjectsAfterEachTest();

// M1-07 (shell, 404s), M1-08 (home: list, create), M1-09 (header edit, delete project).

test.describe('home: create and list projects', () => {
  test('create validates the title, then opens the new project', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText(/title is required/i)).toBeVisible();
    await expect(page).toHaveURL('/');

    const title = uniqueTitle('Create');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Artist').fill('Trad.');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/project\/\d+/);
    await expect(page.getByLabel('Title')).toHaveValue(title);
    await expect(page.getByLabel('Artist')).toHaveValue('Trad.');
  });

  test('a project shows in the list with its artist and track count; clicking opens it', async ({
    page,
    request,
  }) => {
    const title = uniqueTitle('Listed');
    const { id } = await apiCreateProject(request, title);
    await apiUploadTrack(request, id, 'Lead');
    await page.goto('/');
    const row = page.getByRole('link', { name: new RegExp(title) });
    await expect(row).toContainText('1 track');
    await expect(row).toContainText(/just now|seconds? ago|minute/i);
    await row.click();
    await expect(page).toHaveURL(`/project/${id}`);
    await expect(page.getByTestId('panel-Lead')).toBeVisible();
  });

  test('unknown routes and unknown projects show a not-found page with a way home', async ({
    page,
  }) => {
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
    await page
      .getByRole('link', { name: /home|projects/i })
      .first()
      .click();
    await expect(page).toHaveURL('/');

    await page.goto('/project/999999');
    await expect(page.getByText(/project not found/i)).toBeVisible();
  });
});

test.describe('project header', () => {
  test('title, artist and notes save on blur or Enter and show Saved; Esc undoes', async ({
    page,
    request,
  }) => {
    const { id } = await apiCreateProject(request, uniqueTitle('Edit'));
    await page.goto(`/project/${id}`);

    const artist = page.getByLabel('Artist');
    await artist.fill('Someone');
    await artist.press('Enter');
    // Each field has its own indicator; several can be on screen at once.
    const savedIn = (label: string) =>
      page.locator('.editable', { has: page.getByLabel(label) }).getByText('Saved');
    await expect(savedIn('Artist')).toBeVisible();

    const notes = page.getByLabel('Notes');
    await notes.fill('Key of G');
    await notes.press('Enter'); // a newline in notes, not a save
    await notes.blur();
    await expect(savedIn('Notes')).toBeVisible();

    const title = page.getByLabel('Title');
    const original = await title.inputValue();
    await title.fill('Changed my mind');
    await title.press('Escape');
    await expect(title).toHaveValue(original);

    await page.reload();
    await expect(page.getByLabel('Artist')).toHaveValue('Someone');
    await expect(page.getByLabel('Notes')).toHaveValue(/Key of G/);
    await expect(page.getByLabel('Title')).toHaveValue(original);
  });

  test('clearing the title shows an error and saves nothing', async ({ page, request }) => {
    const title = uniqueTitle('Keep');
    const { id } = await apiCreateProject(request, title);
    await page.goto(`/project/${id}`);
    await page.getByLabel('Title').fill('');
    await page.getByLabel('Title').blur();
    await expect(page.getByText(/title is required/i)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Title')).toHaveValue(title);
  });
});

test.describe('delete a project', () => {
  test('needs the title typed, then returns home and the project is gone', async ({
    page,
    request,
  }) => {
    const title = uniqueTitle('Doomed');
    const { id } = await apiCreateProject(request, title);
    await apiUploadTrack(request, id, 'One');
    await page.goto(`/project/${id}`);

    await page.getByRole('button', { name: 'Delete project' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Delete '${title}' and its 1 track?`);
    const confirm = dialog.getByRole('button', { name: 'Delete' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill(`${title} nope`);
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/to confirm/).fill(title);
    await confirm.click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);
    expect((await request.get(`/api/projects/${id}`)).status()).toBe(404);
  });

  test('cancelling keeps the project', async ({ page }) => {
    const { title } = await createProjectViaUi(page);
    await page.getByRole('button', { name: 'Delete project' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Title')).toHaveValue(title);
  });
});
