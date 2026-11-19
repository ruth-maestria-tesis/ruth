<template>
  <v-main class="login-bg">
    <slot />
  </v-main>
</template>

<style scoped>
.login-bg {
  min-height: 100vh;
  background: radial-gradient(circle at 20% 20%, #e8f5e9 0%, #f8fafc 55%);
}
</style>
