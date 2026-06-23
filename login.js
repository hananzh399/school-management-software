document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const role = document.getElementById('role').value;
    const username = document.getElementById('username').value;

    if (username && role) {
        // In a real app, you'd validate credentials here
        alert(`Redirecting to ${role} dashboard...`);
        
        switch(role) {
            case 'administrator':
                window.location.href = 'admin.html';
                break;
            case 'teacher':
                window.location.href = 'teacher.html';
                break;
            case 'student':
                window.location.href = 'student.html';
                break;
            default:
                alert('Please select a role');
        }
    } else {
        alert('Please fill in all fields');
    }
});