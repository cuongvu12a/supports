import requests
from typing import List, Dict, Any

from app.core import singleton

BASE_URL = "https://fulfillment.merchize.com"
X_API_KEY = "19e44715-7743-5e02-a66e-9ce064ee5cd1"
API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2YTM2NTM4NGU2ODY2NmNmZWFlZDVhOSIsInVzZXJuYW1lIjoiY3Vvbmd2bisxQGZvb2JsYS5jb20iLCJyb2xlcyI6W3siX2lkIjoiNjU4ZTZhNmViY2U3YTZhNGFmMjFlODlkIiwibmFtZSI6ImZhY19hZG1pbiJ9LHsiX2lkIjoiNjU4ZTZjOGJiY2U3YTZhNGFmMmZlZGE0IiwibmFtZSI6ImZmbV9hZG1pbiJ9LHsiX2lkIjoiNjY4ZjVhMzdiN2E3Y2UzMGE3ZWExYTU5IiwibmFtZSI6ImZhY191c19hZG1pbiJ9XSwiaXNfYWRtaW4iOmZhbHNlLCJkZXBhcnRtZW50Ijp7Il9pZCI6IjY1OGU4ZTMwZTA1ZjVlNWU5NmNmZmM0OCIsImtleSI6IkZGTSIsIm5hbWUiOiJGdWxmaWxsbWVudCIsImNyZWF0ZWRfYXQiOiIyMDIzLTEyLTI5VDA5OjE1OjI4Ljg1OVoiLCJ1cGRhdGVkX2F0IjoiMjAyMy0xMi0yOVQwOToxNToyOC44NTlaIiwiX192IjowfSwicGVybWlzc2lvbnMiOnsiYmF0Y2hfcnVsZV9tYW5hZ2VtZW50IjoiTWFuYWdlIGF1dG8gY3JlYXRlIGJhdGNoIHJ1bGVzIiwiZ2V0X2JyYW5kX3RhZyI6IkdldCBicmFuZCB0YWciLCJ1cGRhdGVfYnJhbmQiOiJ1cGRhdGUgYnJhbmQiLCJjcmVhdGVfYnJhbmQiOiJDcmVhdGUgYnJhbmQiLCJiYXNlX2Nvc3RfbWFuYWdlbWVudCI6IkZBQyBiYXNlIGNvc3QgbWFuYWdlbWVudCIsInVzZXJfYWN0aW9uX21hbmFnZW1lbnQiOiJVc2VyIGFjdGlvbiBtYW5hZ2VtZW50Iiwicm9sZV9tYW5hZ2VtZW50IjoiUm9sZSBtYW5hZ2VtZW50IiwicGVybWlzc2lvbl9tYW5hZ2VtZW50IjoiUGVybWlzc2lvbiBtYW5hZ2VtZW50IiwidXNlcl9tYW5hZ2VtZW50IjoiVXNlciBtYW5hZ2VtZW50IiwicmVxdWVzdF91cGRhdGUiOiJSZXF1ZXN0IHVwZGF0ZSIsImZhY191c2VyX21hbmFnZW1lbnQiOiJGQUMgdXNlciBtYW5hZ2VtZW50IiwiZmFjX3JvbGVfbWFuYWdlbWVudCI6IkZBQyByb2xlIG1hbmFnZW1lbnQiLCJmYWNfcGVybWlzc2lvbl9tYW5hZ2VtZW50IjoiRkFDIHBlcm1pc3Npb24gbWFuYWdlbWVudCIsImZhY19jb25maXJtX2ZmbV9pc3N1ZSI6IkZBQyBjb25maXJtIGZmbSBpc3N1ZSIsImZmbV9pc3N1ZV9saXN0IjoiRkZNIGxpc3QgaXNzdWVzIiwiZmZtX3ZpZXdfaXNzdWVfcmVwb3J0IjoiRkZNIHZpZXcgaXNzdWUgcmVwb3J0IiwiZmFjX3VzX3VzZXJfbWFuYWdlbWVudCI6IlVzZXIgbWFuYWdlbWVudCJ9LCJpYXQiOjE3NDcxMzMyODUsImV4cCI6MTc0OTcyNTI4NX0.UJ2D31QWNYVvlGwcMIpyPVb-2J2cEUJpb5J0awo-UPU"

@singleton
class APIService:
    def __init__(self):
        print("[APIService] __init__")
        self.headers = {
            "Content-Type": "application/json",
            # "x-api-key": X_API_KEY,
            "Authorization": f"Bearer {API_TOKEN}",
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def list_jobs(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not payload:
            raise ValueError("Payload must not be empty")

        url = f"{BASE_URL}/api/order/printing-files/search"
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {}).get("items", [])

    def convert_dtx(self, item, retry_job: bool):
        product_type = item.get("variant_data", {}).get("product_type", "")
        if not product_type.endswith("_PET"):
            print(
                f"❌ Item {item.get('name')}_{item.get('item_number')}: not a PET product, skipping conversion"
            )
            return

        tags = item.get("tags", [])
        if "DTG_2_DTF" in tags:
            print(
                f"✅ Item {item.get('name')}_{item.get('item_number')}: already converted to DTX, skipping"
            )
            return

        item_id = item.get("_id")
        name = item.get("name")
        item_number = item.get("item_number")
        artworks = item.get("artworks", [])

        url = f"{BASE_URL}/api/order/printing-files/items/{item_id}/convert-item-to-dtx"
        payload = {
            "artworks": artworks,
        }
        response = self.session.put(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if success:
            print(f"✅ Item {name}_{item_number}: successfully converted to DTX")
            if retry_job:
                self.retry_job(item)
        else:
            print(f"❌ Item {name}_{item_number}: conversion to DTX failed")

    def change_type(
        self, item, retry_job: bool, add_prefix: str = None, remove_prefix: str = None
    ):
        item_id = item.get("_id")
        name = item.get("name")
        item_number = item.get("item_number")
        product_type = item.get("variant_data", {}).get("product_type", "")
        front = item.get("design_front", None)
        back = item.get("design_back", None)
        sleeves = item.get("design_sleeves", None)
        hood = item.get("design_hood", None)

        if add_prefix:
            if not product_type.startswith(add_prefix):
                updated_product_type = f"{add_prefix}{product_type}"

        if remove_prefix:
            if product_type.startswith(remove_prefix):
                updated_product_type = product_type[len(remove_prefix) :]

        if not updated_product_type:
            print(f"❌ Item {name}_{item_number}: no change in product type, skipping")
            return

        url = f"{BASE_URL}/api/order/fulfillment-items/printing-files/{item_id}/designs"
        payload = {
            "front": front,
            "back": back,
            "sleeves": sleeves,
            "hood": hood,
            "type": updated_product_type,
        }

        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if success:
            print(
                f"✅ Item {name}_{item_number}: successfully changed type to {updated_product_type}"
            )
            if retry_job:
                self.retry_job(item)
        else:
            print(
                f"❌ Item {name}_{item_number}: changing type to {updated_product_type} failed"
            )

    def retry_job(self, item):
        name = item.get("name")
        item_number = item.get("item_number")
        item_id = item.get("_id")
        fulfillment_id = item.get("fulfillment")
        url = f"{BASE_URL}/api/order/printing-files/{fulfillment_id}/items/{item_id}/status/retry"
        response = self.session.put(url)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if success:
            print(f"✅ Item {name}_{item_number}: retry job")
        else:
            print(f"❌ Item {name}_{item_number}: retry job failed")

    def list_supplier(self) -> List[Dict[str, Any]]:
        url = f"{BASE_URL}/api/supplier/v2/suppliers?active&limit=1000&page=1"
        response = self.session.get(url)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {}).get("suppliers", [])

    def get_product_type(self, type: str) -> List[Dict[str, Any]]:
        url = f"{BASE_URL}/api/product/products/search"
        payload = {
            "page": 1,
            "limit": 20,
            "term": "",
            "category": "",
            "product_label": "",
            "type": type,
            "currency": "",
            "sku_prefix": "",
            "available_tiktok": "",
        }

        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        products = json_response.get("data", {}).get("products", [])
        for product in products:
            product_type = product.get("type", "")
            if product_type == type:
                return product

        raise ValueError(f"Product type '{type}' not found")

    def dict_variants(
        self,
        type: str,
        partner_skus: List[str],
        supplier_id: str,
        supplier_prefix: str,
    ) -> List[Dict[str, Any]]:
        product = self.get_product_type(type)
        product_id = product.get("_id")
        url = f"{BASE_URL}/api/product/products/{product_id}/variants/{supplier_id}"
        response = self.session.get(url)
        response.raise_for_status()
        json_response = response.json()
        variants = json_response.get("data", [])
        dict_variants = {}
        for variant in variants:
            partner_sku = variant.get("partner_sku", "")
            if partner_sku in partner_skus:
                _id = variant.get("_id", "")
                as_quantity = variant.get("as_quantity", 1)
                if not _id:
                    print(
                        f"❌ Variant {partner_sku} is missing _id in type '{type}' with supplier '{supplier_prefix}'"
                    )
                    continue
                dict_variants[partner_sku] = {"_id": _id, "as_quantity": as_quantity}
            
            sku = variant.get("sku", "")
            if sku in partner_skus:
                _id = variant.get("_id", "")
                as_quantity = variant.get("as_quantity", 1)
                if not _id:
                    print(
                        f"❌ Variant {sku} is missing _id in type '{type}' with supplier '{supplier_prefix}'"
                    )
                    continue
                dict_variants[sku] = {"_id": _id, "as_quantity": as_quantity}

        for partner_sku in partner_skus:
            if partner_sku not in dict_variants:
                print(
                    f"❌ Variant {partner_sku} not found in type '{type}' with supplier '{supplier_prefix}'"
                )

        return dict_variants

    def list_packages(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not payload:
            raise ValueError("Payload must not be empty")

        url = f"{BASE_URL}/api/order/fulfillments/search-v2"
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {}).get("fulfillments", [])
    
    def detail_package(self, package_id: str) -> Dict[str, Any]:
        if not package_id:
            raise ValueError("Package ID must not be empty")

        url = f"{BASE_URL}/api/order/v2/fulfillments/{package_id}"
        response = self.session.get(url)
        response.raise_for_status()
        json_response = response.json()
        return json_response.get("data", {})
    
    def create_replace_package(self, package_id: str, payload: Dict[str, Any], package_name: str) -> Dict[str, Any]:
        if not package_id or not payload:
            raise ValueError("Package ID and payload must not be empty")

        url = f"{BASE_URL}/api/order/fulfillment/{package_id}/create-replace-package"
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        json_response = response.json()
        success = json_response.get("success")
        if not success:
            print(f"❌ Failed to create replace package for {package_name}, message: {json_response.get('message')}")
        
        return json_response.get("data", {})