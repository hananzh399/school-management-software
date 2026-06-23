document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const sidebar = document.getElementById('sidebar');
    const openSidebarBtn = document.getElementById('open-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar');
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.content-section');

    const modal = document.getElementById('student-modal');
    const closeFormBtns = document.querySelectorAll('.close-modal-btn');
    const admissionForm = document.getElementById('student-admission-form');

    // Navigation Logic
    function navigateTo(sectionId) {
        sections.forEach(s => s.classList.remove('active'));
        document.getElementById(sectionId).classList.add('active');
        
        // Update Sidebar Active Link
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-view') === sectionId) {
                link.classList.add('active');
            }
        });
        
        // Auto-close sidebar on mobile
        sidebar.classList.remove('active');
        window.scrollTo(0, 0);
    }

    // Sidebar Toggles
    openSidebarBtn.addEventListener('click', () => sidebar.classList.add('active'));
    closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('active'));

    // Sidebar Link Clicking
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const view = link.getAttribute('data-view');
            if (view) {
                e.preventDefault();
                navigateTo(view);
            }
        });
    });

    // Global Nav Function for buttons
    window.navigateTo = navigateTo;

    // MODAL LOGIC
    window.openStudentModal = () => {
        modal.style.display = 'block';
    };

    closeFormBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    });

    // Image Preview Logic (Student Photo)
    const photoInput = document.getElementById('student-photo');
    const photoPreview = document.getElementById('student-img-preview');

    photoInput.addEventListener('change', function() {
        const file = this.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                photoPreview.src = e.target.result;
            }
            reader.readAsDataURL(file);
        }
    });

    // Certificate Preview Logic
    const certInput = document.getElementById('cert-upload');
    const certPreviewContainer = document.getElementById('cert-preview-container');

    certInput.addEventListener('change', function() {
        const file = this.files[0];
        if (file) {
            certPreviewContainer.innerHTML = `<span>Selected: ${file.name}</span>`;
            
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.style.display = 'block';
                    img.style.maxWidth = '100%';
                    img.style.marginTop = '10px';
                    certPreviewContainer.appendChild(img);
                }
                reader.readAsDataURL(file);
            }
        }
    });

    // Auto-Age Calculation
    const dobInput = document.getElementById('student-dob');
    const ageInput = document.getElementById('student-age');

    dobInput.addEventListener('change', () => {
        const birthDate = new Date(dobInput.value);
        const today = new Date();
        
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        
        ageInput.value = age >= 0 ? `${age} Years Old` : 'Invalid Date';
    });

    // Form Submission & Success Toast
    admissionForm.addEventListener('submit', (e) => {
        e.preventDefault();

        // 1. Show Toast
        const toast = document.getElementById('toast-msg');
        toast.classList.add('show');

        // 2. Hide Modal
        modal.style.display = 'none';

        // 3. Reset Form & Previews after a delay
        setTimeout(() => {
            toast.classList.remove('show');
            admissionForm.reset();
            photoPreview.src = "https://via.placeholder.com/150?text=Student+Photo";
            certPreviewContainer.innerHTML = "<span>No file selected</span>";
            ageInput.value = "";
        }, 3000);
    });

    // Close modal on outside click
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };
});