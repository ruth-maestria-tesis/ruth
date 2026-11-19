<script setup lang="ts">
// Server links use {CLIENT_URL}/auth/external-access?token=… (spec §2.2).
definePageMeta({ layout: 'blank' });
const route = useRoute();
const token = typeof route.query.token === 'string' ? route.query.token : '';
await navigateTo(token ? `/external/${encodeURIComponent(token)}` : '/login', { replace: true });
</script>

<template>
  <div />
</template>
