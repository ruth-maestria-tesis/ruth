<template>
  <v-main class="login-bg">
    <slot />
  </v-main>
</template>

<style scoped>
.login-bg {
  min-height: 100vh;
  background: radial-gradient(circle at 15% 15%, rgba(108, 71, 255, 0.12) 0%, transparent 45%), radial-gradient(circle at 85% 90%, rgba(245, 165, 36, 0.1) 0%, transparent 40%), rgb(var(--v-theme-background));
}
</style>
