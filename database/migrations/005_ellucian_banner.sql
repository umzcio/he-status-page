-- 005: Ellucian Banner Managed Cloud Integration
-- Adds visibility column and Banner Ellucian service entries
-- Depends on: 002_admin_features.sql (categories table, which seeds the 'banner' category)

-- Add visible column to services (defaults true so existing services remain public)
ALTER TABLE services ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT true;

-- Update Banner category display name
UPDATE categories
SET display_name = 'Banner Ecosystem',
    description  = 'Banner ERP, self-service apps, DegreeWorks, eProcurement, and integrations'
WHERE slug = 'banner';

-- Insert Banner services (all under the existing 'banner' category)
DO $$
DECLARE
    cat_banner      UUID;
    new_service_id  UUID;
BEGIN
    SELECT id INTO cat_banner FROM categories WHERE slug = 'banner';

    FOR new_service_id IN
        INSERT INTO services (name, description, category, category_id, provider, status_api_endpoint, status_api_type, check_enabled, external_link, display_order, visible)
        VALUES
            ('Student Portal (Experience)', 'Student Portal landing page', 'banner', cat_banner, 'ellucian',
             'https://experience.elluciancloud.com/your-tenant/', 'ellucian', true,
             'https://experience.elluciancloud.com/your-tenant/', 100, true),

            ('Application Navigator', 'Banner admin application navigator', 'banner', cat_banner, 'ellucian',
             'https://appnav.example.edu/applicationNavigator/actuator/health', 'ellucian', true,
             'https://appnav.example.edu/applicationNavigator', 110, true),

            ('Employee Self Service', 'HR dashboard, employee profile, labor redistribution', 'banner', cat_banner, 'ellucian',
             'https://employeessb.example.edu/EmployeeSelfService/actuator/health', 'ellucian', true,
             'https://employeessb.example.edu/EmployeeSelfService', 120, true),

            ('Faculty Self Service', 'Faculty dashboard, attendance tracking, grades', 'banner', cat_banner, 'ellucian',
             'https://facultyssb.example.edu/FacultySelfService/actuator/health', 'ellucian', true,
             'https://facultyssb.example.edu/FacultySelfService', 121, true),

            ('Finance Self Service', 'Finance self-service portal', 'banner', cat_banner, 'ellucian',
             'https://financessb.example.edu/FinanceSelfService/actuator/health', 'ellucian', true,
             'https://financessb.example.edu/FinanceSelfService', 122, true),

            ('Student Self Service', 'Student dashboard, profile, grades, financial aid, account info', 'banner', cat_banner, 'ellucian',
             'https://studentssb.example.edu/StudentSelfService/actuator/health', 'ellucian', true,
             'https://studentssb.example.edu/StudentSelfService', 123, true),

            ('General Self Service', 'Personal info, direct deposit, proxy management, action items', 'banner', cat_banner, 'ellucian',
             'https://generalssb.example.edu/BannerGeneralSsb/actuator/health', 'ellucian', true,
             'https://generalssb.example.edu/BannerGeneralSsb', 124, true),

            ('Student Registration', 'Class registration, course catalog, browse classes', 'banner', cat_banner, 'ellucian',
             'https://reg.example.edu/StudentRegistrationSsb/actuator/health', 'ellucian', true,
             'https://reg.example.edu/StudentRegistrationSsb', 125, true),

            ('DegreeWorks', 'Degree audit, advising, and transfer equivalency', 'banner', cat_banner, 'ellucian',
             'https://dw.example.edu/responsiveDashboard/', 'ellucian', true,
             'https://dw.example.edu/responsiveDashboard/', 130, true),

            ('eInvoicing', 'Electronic invoicing', 'banner', cat_banner, 'ellucian',
             'https://einvoice.example.edu/', 'ellucian', true,
             'https://einvoice.example.edu/', 140, true),

            ('eProcurement', 'Electronic procurement', 'banner', cat_banner, 'ellucian',
             'https://eproc.example.edu/default-app/', 'ellucian', true,
             'https://eproc.example.edu/default-app/', 141, true),

            ('eVisions / MAPS', 'Intellecheck, Form Fusion, Argos', 'banner', cat_banner, 'ellucian',
             'https://maps.example.edu', 'ellucian', true,
             'https://maps.example.edu', 150, true),

            ('Communication Management', 'Banner Communication Management', 'banner', cat_banner, 'ellucian',
             'https://bcm.example.edu/CommunicationManagement/actuator/health', 'ellucian', true,
             'https://bcm.example.edu/CommunicationManagement', 160, true),

            ('Banner Workflow', 'Legacy Banner Workflow 1.0', 'banner', cat_banner, 'ellucian',
             'https://workflow.example.edu/wfprod/logon.jsp', 'ellucian', true,
             'https://workflow.example.edu/wfprod', 161, true),

            ('Automic (UC4)', 'Job scheduling and automation', 'banner', cat_banner, 'ellucian',
             'http://jobsub.example.edu:5050/AMPROD/Intro.html', 'ellucian', true,
             'http://jobsub.example.edu:5050/AMPROD/Intro.html', 162, true),

            ('ETHOS / BEP / BEIS', 'Banner Event Publisher, integration services', 'banner', cat_banner, 'ellucian',
             'https://beis.example.edu:9006/BannerEventPublisher', 'ellucian', true,
             'https://beis.example.edu:9006/BannerEventPublisher', 170, true),

            -- Internal (monitored but hidden from public page)
            ('Banner Access Management', 'Banner access management admin tool', 'banner', cat_banner, 'ellucian',
             'https://banneradmin.example.edu/BannerAccessMgmt/', 'ellucian', true,
             'https://banneradmin.example.edu/BannerAccessMgmt/', 180, false),

            ('Ethos API Management', 'Ethos API Management Center', 'banner', cat_banner, 'ellucian',
             'https://banneradmin.example.edu/ethosapimanagementcenter', 'ellucian', true,
             'https://banneradmin.example.edu/ethosapimanagementcenter', 181, false),

            ('Axiom Elite (Slate)', 'Axiom Elite production instance', 'banner', cat_banner, 'ellucian',
             'https://axiomelite.example.edu/', 'ellucian', true,
             'https://axiomelite.example.edu/', 182, false)

        ON CONFLICT DO NOTHING
        RETURNING id
    LOOP
        -- Initialize service_status for each new service
        INSERT INTO service_status (service_id, status, status_source, status_message)
        VALUES (new_service_id, 'operational', 'automated', 'Initial status')
        ON CONFLICT (service_id) DO NOTHING;

        -- Initialize status_history
        INSERT INTO status_history (service_id, status, status_source, status_message, started_at)
        VALUES (new_service_id, 'operational', 'automated', 'Initial status', NOW());
    END LOOP;
END $$;
