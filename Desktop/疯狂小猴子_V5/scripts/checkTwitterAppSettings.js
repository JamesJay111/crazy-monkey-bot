/**
 * Twitter App 设置检查清单
 * 帮助用户确认 Twitter Developer Portal 中的设置是否正确
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function checkSettings() {
  console.log('🔍 Twitter Developer Portal 设置检查清单\n');
  console.log('请访问: https://developer.twitter.com/en/portal/dashboard\n');
  console.log('找到你的 App，然后进入 Settings → User authentication settings\n');
  console.log('==============================\n');

  // 检查 App permissions
  const permissions = await question('1️⃣  App permissions 当前设置是什么？\n   (输入: read-only 或 read-write): ');
  console.log('');

  if (permissions.toLowerCase().includes('read-only')) {
    console.log('❌ 问题找到了！App permissions 必须是 "Read and write"\n');
    console.log('📋 修改步骤:');
    console.log('   1. 在 User authentication settings 中点击 "Edit"');
    console.log('   2. 将 "App permissions" 从 "Read only" 改为 "Read and write"');
    console.log('   3. 点击 "Save"');
    console.log('   4. 等待 2-5 分钟让设置生效\n');
    rl.close();
    return;
  }

  // 检查 App Type
  const appType = await question('2️⃣  App Type 当前设置是什么？\n   (输入: web-app 或其他): ');
  console.log('');

  if (!appType.toLowerCase().includes('web')) {
    console.log('⚠️  App Type 应该是 "Web App, Automated App or Bot"\n');
  }

  // 检查 OAuth 2.0
  const oauth2 = await question('3️⃣  OAuth 2.0 是否已启用？\n   (输入: yes 或 no): ');
  console.log('');

  if (oauth2.toLowerCase() !== 'yes') {
    console.log('❌ OAuth 2.0 必须启用\n');
  }

  // 检查 Callback URI
  const callbackUri = await question('4️⃣  Callback URI 是否包含 http://localhost:8787/x/callback？\n   (输入: yes 或 no): ');
  console.log('');

  if (callbackUri.toLowerCase() !== 'yes') {
    console.log('❌ Callback URI 必须包含: http://localhost:8787/x/callback\n');
  }

  // 检查授权页面显示
  const authPage = await question('5️⃣  授权页面显示的是什么权限？\n   (输入: read-only 或 read-write): ');
  console.log('');

  if (authPage.toLowerCase().includes('read-only')) {
    console.log('❌ 授权页面显示 "Read only"，说明权限设置还没生效\n');
    console.log('📋 解决方案:');
    console.log('   1. 确认 Twitter Developer Portal 中已保存为 "Read and write"');
    console.log('   2. 等待 5-10 分钟让设置生效');
    console.log('   3. 清除浏览器缓存');
    console.log('   4. 使用新的授权链接重新授权\n');
  } else {
    console.log('✅ 授权页面显示 "Read and write"，权限设置正确\n');
  }

  console.log('==============================\n');
  console.log('📋 总结:');
  console.log('   如果所有设置都正确但仍然 403，可能的原因:');
  console.log('   1. 权限修改后需要等待更长时间（5-10 分钟）');
  console.log('   2. 需要清除浏览器缓存后重新授权');
  console.log('   3. Twitter API 可能需要时间同步权限\n');

  rl.close();
}

checkSettings().catch(console.error);

