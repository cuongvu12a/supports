from app.actions.convert_dtx import convert_job
from app.actions.replace_package import replace_package

      
def main():
    replace_package('replace_package.csv')
    
#     convert_job({
#   "page": 1,
#   "limit": 50,
#   "request_update_statuses": [
#     "no-request"
#   ],
#   "order_number": "RK-53583-26879 RQ-88957-83643 RJ-73987-99857 RP-32924-29575 RP-66459-69563 RA-28794-27343 RN-38529-45382 RZ-48278-39337 RE-84554-93554",
#   "supplier": "62ac08b39a4929c5d544a01c",
#   "update_design_count": "",
#   "package_names": [],
#   "show_archive": "hide_archive",
#   "barcode_numbers": "",
#   "namespaces": "",
#   "brand_name": ""
# })
    

if __name__ == "__main__":
    main()
