from app.services import APIService


def main():
    api_service = APIService()
    jobs = api_service.list_jobs(
        {
            "page": 1,
            "limit": 10,
            "request_update_statuses": [],
            "package_names": [
                "RK-22868-37385-F1",
                "RQ-87937-95658-F1",
                "RQ-22972-39794-F1",
                "RM-85662-69475-F1",
            ],
            "update_design_count": "",
            "order_number": "",
            "show_archive": "hide_archive",
            "barcode_numbers": "",
            "namespaces": "",
            "brand_name": "",
        }
    )

    for job in jobs:
        api_service.convert_dtx(job, retry_job=True)


if __name__ == "__main__":
    main()
