function togglePw() {
    const pw = document.getElementById('password');
    const icon = document.getElementById('eyeIcon');
    if (pw.type === 'password') {
      pw.type = 'text';
      icon.className = 'fas fa-eye-slash';
    } else {
      pw.type = 'password';
      icon.className = 'fas fa-eye';
    }
  }
 
  function handleLogin(e) {
    e.preventDefault();
    const phone = document.getElementById('phone').value;
    if (phone) {
      alert('Signing you in… redirecting to dashboard.');
    }
  }
 
  function openVideo() {
    document.getElementById('videoModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
 
  function closeVideo() {
    document.getElementById('videoModal').classList.remove('open');
    document.body.style.overflow = '';
  }
 
  function closeVideoOutside(e) {
    if (e.target === document.getElementById('videoModal')) closeVideo();
  }
 
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeVideo();
  });
